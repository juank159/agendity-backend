import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not, Repository } from 'typeorm';
import { TenantSettingsService } from 'src/settings/tenant-settings.service';
import { assertClientIdFree } from 'src/common/utils/client-id';
import { ErrorCode } from 'src/common/constants/error-codes';

/** Motivos de un pago en revisión (10.01b). */
export const PAYMENT_REVIEW = {
  appointmentCancelled: 'APPOINTMENT_CANCELLED',
  overpaid: 'OVERPAID',
} as const;

/** ¿Es un error de negocio con ese `code`? */
function isCode(error: unknown, code: string): boolean {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  return (response as { code?: string } | undefined)?.code === code;
}
import { Payment } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentStatus } from '../common/enums/status.enum';
import {
  AppointmentPaidSummary,
  appointmentPaymentStatus,
  applyRefund,
  assertPaymentAmount,
  fromCents,
  netAmountSql,
  toCents,
} from './payment-rules';
import { statusAfterPayment } from '../appointments/appointment-status';
import {
  NotificationType,
  ReceiverType,
} from '../notifications/entities/notification.entity';
import { RELATIONS } from './constants/payment-relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { rethrowPaymentError } from './payment-errors';
import { PaymentNotification } from './interfaces/payment-notification.interface';
import { CustomPaymentMethodsService } from './custom-payment-methods.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
    private readonly dataSource: DataSource,
    private readonly tenantSettings: TenantSettingsService,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    rethrowPaymentError(this.logger, error, options);
  }

  /**
   * Lo pagado neto de una cita y si tuvo reembolsos (2.24). Se llama DENTRO de
   * la transacción y con la cita bloqueada (`lockAppointment`): dos pagos
   * simultáneos a la misma cita se serializan y el segundo ya ve el primero,
   * así que la suma nunca pasa del total.
   */
  private async loadPaidSummary(
    manager: EntityManager,
    appointmentId: string,
  ): Promise<AppointmentPaidSummary> {
    const [row] = await manager.query(
      `SELECT COALESCE(SUM(${netAmountSql('p')}) FILTER (WHERE p.status = 'COMPLETED'), 0) AS paid,
              COALESCE(bool_or(p.status = 'REFUNDED' OR COALESCE(p.refund_amount, 0) > 0), false) AS has_refunds
         FROM payments p
        WHERE p."appointmentId" = $1
          -- 10.01b: un pago en revisión no cuenta hasta resolverlo.
          AND p.review_required IS NULL`,
      [appointmentId],
    );
    return {
      paidCents: toCents(row?.paid),
      hasRefunds: row?.has_refunds === true,
    };
  }

  private async sendPaymentNotification(
    notification: PaymentNotification,
    isRefund = false,
  ): Promise<void> {
    await this.notificationsService.create({
      receiver_id: notification.receiver_id,
      receiver_type: ReceiverType.CLIENT,
      type: NotificationType.PAYMENT_CONFIRMATION,
      title: isRefund ? 'Reembolso Procesado' : 'Pago Confirmado',
      message: isRefund
        ? `Se ha procesado un reembolso de $${notification.payment_amount}`
        : `Tu pago de $${notification.payment_amount} ha sido procesado exitosamente`,
      metadata: {
        appointment_id: notification.appointment_id,
        payment_id: notification.payment_id,
      },
    });
  }

  /**
   * Registra un pago COMPLETED (2.06; anticipos desde 2.24), en UNA transacción:
   * 1. Cita del negocio con lock de fila (ajena = 404).
   * 2. La cita no puede estar CANCELLED (`INVALID_STATE_TRANSITION`).
   * 3. Lo pagado neto, leído bajo el lock: si ya cubre el total →
   *    `PAYMENT_ALREADY_EXISTS` (409); si no, monto > 0 y ≤ saldo pendiente.
   * 4. Inserta el pago y aplica la máquina de estados (PENDING → CONFIRMED al
   *    primer pago) con `payment_status` PARTIAL o COMPLETED según lo pagado.
   * La notificación al cliente va después del commit.
   */
  async create(
    createPaymentDto: CreatePaymentDto,
    tenantId: string,
    options: { reviewOnConflict?: boolean } = {},
  ): Promise<Payment> {
    try {
      // Id generado por la app (10.01b): no puede existir ya.
      await assertClientIdFree(
        this.dataSource.manager,
        Payment,
        createPaymentDto.id,
      );
      // Referencias del negocio validadas antes de abrir la transacción (404).
      const appointment = await this.appointmentsService.findOne(
        createPaymentDto.appointment_id,
        tenantId,
      );
      if (createPaymentDto.custom_payment_method_id) {
        await this.customPaymentMethodsService.findOne(
          createPaymentDto.custom_payment_method_id,
          tenantId,
        );
      }

      // Zona del negocio al registrar el pago (6.03): el pago la conserva.
      const timeZone = await this.tenantSettings.getTimezone(tenantId);
      const savedPayment = await this.dataSource.transaction(
        async (manager) => {
          const locked = await this.appointmentsService.lockAppointment(
            manager,
            appointment.id,
            tenantId,
          );
          // Pago hecho sin conexión (10.01b, D-18): si no cabe, se guarda en
          // revisión en vez de perderlo (el dinero se recibió).
          let review: string | null = null;
          try {
            statusAfterPayment(locked.status); // CANCELLED → 409, antes de escribir
          } catch (error) {
            if (
              !options.reviewOnConflict ||
              !isCode(error, ErrorCode.INVALID_STATE_TRANSITION)
            ) {
              throw error;
            }
            review = PAYMENT_REVIEW.appointmentCancelled;
          }
          const paid = await this.loadPaidSummary(manager, locked.id);
          if (!review) {
            try {
              assertPaymentAmount(
                createPaymentDto.amount,
                locked.total_price,
                paid.paidCents,
              );
            } catch (error) {
              const exceeds =
                toCents(createPaymentDto.amount) > 0 &&
                (isCode(error, ErrorCode.PAYMENT_ALREADY_EXISTS) ||
                  isCode(error, ErrorCode.BAD_REQUEST));
              if (!options.reviewOnConflict || !exceeds) throw error;
              review = PAYMENT_REVIEW.overpaid;
            }
          }

          const repo = manager.getRepository(Payment);
          const payment = await repo.save(
            repo.create({
              id: createPaymentDto.id,
              reviewRequired: review,
              amount: createPaymentDto.amount,
              payment_method: createPaymentDto.payment_method,
              custom_payment_method_id:
                createPaymentDto.custom_payment_method_id,
              transaction_id: createPaymentDto.transaction_id,
              payment_details: createPaymentDto.payment_details,
              appointment: { id: locked.id } as any,
              status: PaymentStatus.COMPLETED,
              ownerId: tenantId,
              timezone: timeZone,
            }),
          );
          // En revisión: no toca la cita hasta resolverlo.
          if (review) return payment;
          // PENDING → CONFIRMED (máquina de estados) y PARTIAL/COMPLETED.
          await this.appointmentsService.applyPaymentStatus(
            manager,
            locked,
            appointmentPaymentStatus(locked.total_price, {
              ...paid,
              paidCents: paid.paidCents + toCents(createPaymentDto.amount),
            }),
            true,
          );
          return payment;
        },
      );

      await this.notifySafely({
        receiver_id: appointment.client?.id,
        payment_amount: createPaymentDto.amount,
        appointment_id: appointment.id,
        payment_id: savedPayment.id,
      });

      return await this.paymentRepository.findOne({
        where: { id: savedPayment.id, ownerId: tenantId },
        relations: RELATIONS.MINIMAL,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'el pago',
        operation: 'crear',
      });
    }
  }

  /** La notificación no deshace un pago ya guardado: si falla, solo se registra. */
  private async notifySafely(
    notification: PaymentNotification,
    isRefund = false,
  ): Promise<void> {
    if (!notification.receiver_id) return;
    try {
      await this.sendPaymentNotification(notification, isRefund);
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar el ${isRefund ? 'reembolso' : 'pago'} ${notification.payment_id}: ${error?.message}`,
      );
    }
  }

  /** Pagos con `review_required` del negocio (10.01b). */
  findInReview(tenantId: string): Promise<Payment[]> {
    return this.paymentRepository.find({
      where: { ownerId: tenantId, reviewRequired: Not(IsNull()) },
      relations: RELATIONS.APPOINTMENT_WITH_CUSTOM_METHOD,
      order: { created_at: 'ASC' },
    });
  }

  async findAll(tenantId: string): Promise<Payment[]> {
    try {
      return await this.paymentRepository.find({
        where: { ownerId: tenantId },
        relations: RELATIONS.APPOINTMENT_WITH_CUSTOM_METHOD,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'listar',
      });
    }
  }

  async findByAppointment(
    appointmentId: string,
    tenantId: string,
  ): Promise<Payment[]> {
    try {
      await this.appointmentsService.findOne(appointmentId, tenantId);

      return await this.paymentRepository.find({
        where: {
          appointment: { id: appointmentId },
          ownerId: tenantId,
        },
        relations: RELATIONS.MINIMAL,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
      });
    }
  }

  async findOne(id: string, tenantId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: {
        id,
        ownerId: tenantId,
      },
      relations: RELATIONS.APPOINTMENT,
    });

    if (!payment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado`);
    }

    return payment;
  }

  /**
   * Reembolso parcial o total de UN pago (2.06), en UNA transacción con locks
   * en orden cita → pago (el mismo que crear un pago). Se acumula en
   * `refund_amount`: mientras quede saldo el pago sigue COMPLETED; al devolver
   * todo pasa a REFUNDED. El `payment_status` de la cita se recalcula con lo
   * pagado neto de todos sus pagos (2.24: PARTIAL si queda algo por debajo del
   * total, REFUNDED si no queda nada). El `status` de la cita no cambia.
   */
  async refund(
    id: string,
    refundDto: RefundPaymentDto,
    tenantId: string,
  ): Promise<Payment> {
    try {
      const payment = await this.findOne(id, tenantId);
      if (!payment.appointment) {
        throw new NotFoundException(`Pago con ID ${id} no encontrado`);
      }

      const refunded = await this.dataSource.transaction(async (manager) => {
        const locked = await this.appointmentsService.lockAppointment(
          manager,
          payment.appointment.id,
          tenantId,
        );
        const repo = manager.getRepository(Payment);
        const current = await repo.findOne({
          where: { id, ownerId: tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) {
          throw new NotFoundException(`Pago con ID ${id} no encontrado`);
        }

        const { refundedCents, status } = applyRefund(
          current,
          refundDto.refund_amount,
        );
        await repo.update(
          { id: current.id },
          {
            status,
            refund_amount: fromCents(refundedCents),
            refund_reason: refundDto.refund_reason,
          },
        );
        // 10.01b: un pago en revisión se resuelve solo cuando, con este
        // reembolso, ya cabe (cita cancelada: devuelto entero; de más: lo
        // pagado de la cita con él no pasa del total).
        if (current.reviewRequired) {
          const netCents = toCents(current.amount) - refundedCents;
          const others = await this.loadPaidSummary(manager, locked.id);
          const fits =
            current.reviewRequired === PAYMENT_REVIEW.appointmentCancelled
              ? netCents <= 0
              : others.paidCents + netCents <= toCents(locked.total_price);
          if (fits) {
            await repo.update({ id: current.id }, { reviewRequired: null });
          }
        }
        // Estado de pago de la cita con lo que queda pagado (incluye este
        // reembolso: misma transacción). El `status` de la cita no cambia.
        const appointmentStatus = appointmentPaymentStatus(
          locked.total_price,
          await this.loadPaidSummary(manager, locked.id),
        );
        if (appointmentStatus !== locked.payment_status) {
          await this.appointmentsService.applyPaymentStatus(
            manager,
            locked,
            appointmentStatus,
            false,
          );
        }
        return repo.findOne({
          where: { id: current.id },
          relations: RELATIONS.MINIMAL,
        });
      });

      await this.notifySafely(
        {
          receiver_id: payment.appointment.client?.id,
          payment_amount: refundDto.refund_amount,
          appointment_id: payment.appointment.id,
          payment_id: payment.id,
        },
        true,
      );

      return refunded;
    } catch (error) {
      this.handleError(error, {
        entity: 'el pago',
        operation: 'reembolsar',
      });
    }
  }
}
