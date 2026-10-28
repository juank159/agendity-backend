import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { PaymentStats } from './interfaces/payment-stats.interface';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { PaymentNotification } from './interfaces/payment-notification.interface';
import { CustomPaymentMethodsService } from './custom-payment-methods.service';
import { PaymentMethodStats } from './interfaces/payment-method-stats.interface';
import { PaymentComparisonStats } from './interfaces/payment-comparison-stats.interface';
import {
  ServiceRevenueRow,
  ServiceStats,
} from './interfaces/service-stats.interface';
import { ProfessionalStats } from './interfaces/professional-stats.interface';
import { ClientStats } from './interfaces/client-stats.interface';
import {
  businessTimeZone,
  endOfBusinessDay,
  startOfBusinessDay,
} from '../common/utils/date.util';

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
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    // Toda HttpException (incluidas BusinessException 409) sale tal cual.
    if (error instanceof HttpException) {
      throw error;
    }
    this.logger.error(
      `Error al ${options.operation} ${options.entity}: ${error?.message}`,
    );

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
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
        WHERE p."appointmentId" = $1`,
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
  ): Promise<Payment> {
    try {
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

      const savedPayment = await this.dataSource.transaction(
        async (manager) => {
          const locked = await this.appointmentsService.lockAppointment(
            manager,
            appointment.id,
            tenantId,
          );
          statusAfterPayment(locked.status); // CANCELLED → 409, antes de escribir
          const paid = await this.loadPaidSummary(manager, locked.id);
          assertPaymentAmount(
            createPaymentDto.amount,
            locked.total_price,
            paid.paidCents,
          );

          const repo = manager.getRepository(Payment);
          const payment = await repo.save(
            repo.create({
              amount: createPaymentDto.amount,
              payment_method: createPaymentDto.payment_method,
              custom_payment_method_id:
                createPaymentDto.custom_payment_method_id,
              transaction_id: createPaymentDto.transaction_id,
              payment_details: createPaymentDto.payment_details,
              appointment: { id: locked.id } as any,
              status: PaymentStatus.COMPLETED,
              ownerId: tenantId,
            }),
          );
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

  /**
   * Ingreso neto por servicio (2.28), ÚNICA consulta de "por servicio" (la usan
   * `stats/by-service` y `employee-stats.by_service`). Lo pagado neto de cada
   * cita en el periodo (pagos COMPLETED, `amount − refund_amount`) se reparte
   * entre sus servicios en proporción a su precio (a partes iguales si todos
   * valen 0). Así cada cita cuenta una vez por servicio, tenga los pagos que
   * tenga, y la suma de todos los servicios = ingreso neto del periodo.
   * El reparto usa el precio de cada servicio guardado EN LA CITA
   * (`appointment_services.price`, 2.29), no el precio actual del catálogo:
   * cambiar un precio no altera los informes del pasado.
   */
  private async serviceRevenue(
    tenantId: string,
    start: Date,
    end: Date,
    professionalId?: string,
  ): Promise<ServiceRevenueRow[]> {
    const params: unknown[] = [
      tenantId,
      start.toISOString(),
      end.toISOString(),
    ];
    if (professionalId) params.push(professionalId);
    const rows = await this.paymentRepository.manager.query(
      `
      WITH paid AS (
        SELECT p."appointmentId" AS appointment_id,
               SUM(${netAmountSql('p')}) AS net,
               COUNT(*) AS payments
          FROM payments p
          JOIN appointments a ON a.id = p."appointmentId"
         WHERE p.owner_id = $1
           AND p.status = 'COMPLETED'
           AND p.created_at BETWEEN $2 AND $3
           ${professionalId ? 'AND a.professional_id = $4' : ''}
         GROUP BY p."appointmentId"
      ), lines AS (
        SELECT aps.appointment_id, s.id AS service_id, s.name AS service_name,
               aps.price,
               SUM(aps.price) OVER (PARTITION BY aps.appointment_id) AS appointment_price,
               COUNT(*) OVER (PARTITION BY aps.appointment_id) AS appointment_lines
          FROM appointment_services aps
          JOIN services s ON s.id = aps.service_id
         WHERE aps.appointment_id IN (SELECT appointment_id FROM paid)
      )
      SELECT l.service_id, l.service_name,
             COUNT(DISTINCT l.appointment_id) AS appointment_count,
             SUM(paid.payments) AS payment_count,
             SUM(paid.net * CASE WHEN l.appointment_price > 0
                                 THEN l.price / l.appointment_price
                                 ELSE 1.0 / l.appointment_lines END) AS total_amount
        FROM lines l
        JOIN paid ON paid.appointment_id = l.appointment_id
       GROUP BY l.service_id, l.service_name
       ORDER BY total_amount DESC
      `,
      params,
    );
    return rows.map((row: any) => ({
      service_id: row.service_id,
      service_name: row.service_name,
      appointment_count: Number(row.appointment_count) || 0,
      payment_count: Number(row.payment_count) || 0,
      total_amount: Math.round((Number(row.total_amount) || 0) * 100) / 100,
    }));
  }

  async getPaymentStats(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<PaymentStats> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // Una sola consulta agregada en la BD (2.26: antes cargaba y registraba
      // en el log TODOS los pagos del negocio en cada llamada).
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .select(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .addSelect('COUNT(*)', 'payment_count')
        .addSelect(`AVG(${netAmountSql('payment')})`, 'average_amount')
        .getRawOne();

      return {
        total_amount: Number(result.total_amount) || 0,
        payment_count: Number(result.payment_count) || 0,
        average_amount: Number(result.average_amount) || 0,
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al calcular estadísticas',
      });
    }
  }

  async getEmployeeStats(
    professionalId: string,
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<any> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // Totales del profesional en el periodo (2.26: sin las consultas de
      // diagnóstico ni la misma suma repetida en SQL nativo).
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .select(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect('COUNT(DISTINCT appointment.id)', 'appointment_count')
        .innerJoin('payment.appointment', 'appointment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('appointment.professional_id = :professionalId', {
          professionalId,
        })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .getRawOne();

      // Desglose por servicio: ingreso neto repartido (2.28, `serviceRevenue`)
      let serviceBreakdown: ServiceRevenueRow[] = [];
      try {
        serviceBreakdown = await this.serviceRevenue(
          tenantId,
          startDate,
          adjustedEndDate,
          professionalId,
        );
      } catch (serviceError) {
        this.logger.error(
          `Estadísticas del profesional: falló el desglose por servicio: ${serviceError?.message}`,
        );
        serviceBreakdown = [];
      }

      // Evolución diaria: pagos y citas por separado (2.28)
      let dailyStats = [];
      try {
        dailyStats = await this.paymentRepository.manager.query(
          `
        SELECT 
          to_char(p.created_at AT TIME ZONE $5::text, 'YYYY-MM-DD') as date,
          SUM(${netAmountSql('p')}) as daily_total,
          COUNT(DISTINCT p.id) as daily_count,
          COUNT(DISTINCT p."appointmentId") as daily_appointments
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED'
        AND a."professional_id" = $2
        AND p.created_at BETWEEN $3 AND $4
        GROUP BY 1
        ORDER BY 1 ASC
      `,
          [
            tenantId,
            professionalId,
            startDate.toISOString(),
            adjustedEndDate.toISOString(),
            businessTimeZone(),
          ],
        );
      } catch (dailyError) {
        this.logger.error(
          `Estadísticas del profesional: falló la evolución diaria: ${dailyError?.message}`,
        );
        dailyStats = [];
      }

      // Preparar respuesta con los datos obtenidos
      const totalAmount = Number(result?.total_amount) || 0;
      const paymentCount = Number(result?.payment_count) || 0;
      const summary = {
        total_amount: totalAmount,
        payment_count: paymentCount,
        appointment_count: Number(result?.appointment_count) || 0,
        average_per_payment: paymentCount > 0 ? totalAmount / paymentCount : 0,
      };

      return {
        summary: summary,
        // `count` = citas en las que se hizo el servicio (2.28: antes, pagos).
        by_service: serviceBreakdown.map((item) => ({
          service_id: item.service_id,
          service_name: item.service_name,
          count: item.appointment_count,
          total: item.total_amount,
        })),
        // `count` (= `payment_count`) son pagos, como antes; `appointment_count`
        // son las citas distintas que recibieron esos pagos (2.28).
        daily_evolution: dailyStats.map((item) => ({
          date: item.date,
          total: Number(item.daily_total || 0),
          count: Number(item.daily_count || 0),
          payment_count: Number(item.daily_count || 0),
          appointment_count: Number(item.daily_appointments || 0),
        })),
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas del profesional',
      });
    }
  }

  async getPaymentStatsByMethod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<PaymentMethodStats[]> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // Métodos estándar y propios (2.28: antes solo los estándar, y los
      // porcentajes no sumaban 100). Un pago con método propio cuenta como
      // CUSTOM con el nombre del método; el porcentaje es sobre la suma de
      // todos los grupos (= ingreso neto del periodo).
      const rows = await this.paymentRepository.manager.query(
        `
        SELECT
          CASE WHEN p.custom_payment_method_id IS NOT NULL
               THEN COALESCE(cpm.name, 'Método propio')
               ELSE COALESCE(p.payment_method::text, 'SIN_METODO') END AS method,
          CASE WHEN p.custom_payment_method_id IS NOT NULL
               THEN 'CUSTOM' ELSE 'STANDARD' END AS method_type,
          p.custom_payment_method_id AS custom_payment_method_id,
          COUNT(*) AS count,
          SUM(${netAmountSql('p')}) AS total
        FROM payments p
        LEFT JOIN custom_payment_methods cpm
          ON cpm.id = p.custom_payment_method_id AND cpm.owner_id = p.owner_id
        WHERE p.owner_id = $1
          AND p.status = 'COMPLETED'
          AND p.created_at BETWEEN $2 AND $3
        GROUP BY 1, 2, 3
        `,
        [tenantId, startDate.toISOString(), adjustedEndDate.toISOString()],
      );
      const grandTotal = rows.reduce(
        (sum: number, item: any) => sum + (Number(item.total) || 0),
        0,
      );

      const results: PaymentMethodStats[] = rows.map((item: any) => {
        const count = Number(item.count) || 0;
        const total = Number(item.total) || 0;
        return {
          method: item.method,
          method_type: item.method_type,
          custom_payment_method_id: item.custom_payment_method_id ?? null,
          count,
          total,
          average: count > 0 ? total / count : 0,
          percentage: grandTotal > 0 ? (total * 100) / grandTotal : 0,
        };
      });

      // Ordenar por total (de mayor a menor)
      return results.sort((a, b) => b.total - a.total);
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por método de pago',
      });
    }
  }

  async getPaymentStatsComparison(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<PaymentComparisonStats> {
    try {
      // Días completos del negocio: [00:00 del inicio, 23:59:59.999 del fin]
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);
      const periodDuration = adjustedEndDate.getTime() - startDate.getTime();

      // Período anterior: misma duración y termina justo antes del actual
      const adjustedPreviousEndDate = new Date(startDate.getTime() - 1);
      const previousStartDate = new Date(
        adjustedPreviousEndDate.getTime() - periodDuration,
      );

      // Obtener estadísticas para ambos períodos
      const currentStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );
      const previousStats = await this.getPaymentStats(
        previousStartDate,
        adjustedPreviousEndDate,
        tenantId,
      );

      // Calcular diferencias y cambios porcentuales
      const amountDifference =
        currentStats.total_amount - previousStats.total_amount;
      const amountPercentage =
        previousStats.total_amount !== 0
          ? (amountDifference * 100) / previousStats.total_amount
          : currentStats.total_amount > 0
            ? 100
            : 0;

      const countDifference =
        currentStats.payment_count - previousStats.payment_count;
      const countPercentage =
        previousStats.payment_count !== 0
          ? (countDifference * 100) / previousStats.payment_count
          : currentStats.payment_count > 0
            ? 100
            : 0;

      const averageDifference =
        currentStats.average_amount - previousStats.average_amount;
      const averagePercentage =
        previousStats.average_amount !== 0
          ? (averageDifference * 100) / previousStats.average_amount
          : currentStats.average_amount > 0
            ? 100
            : 0;

      return {
        current_period: {
          start_date: startDate,
          end_date: adjustedEndDate,
          total_amount: currentStats.total_amount,
          payment_count: currentStats.payment_count,
          average_amount: currentStats.average_amount,
        },
        previous_period: {
          start_date: previousStartDate,
          end_date: adjustedPreviousEndDate,
          total_amount: previousStats.total_amount,
          payment_count: previousStats.payment_count,
          average_amount: previousStats.average_amount,
        },
        change: {
          amount_difference: amountDifference,
          amount_percentage: parseFloat(amountPercentage.toFixed(2)),
          count_difference: countDifference,
          count_percentage: parseFloat(countPercentage.toFixed(2)),
          average_difference: averageDifference,
          average_percentage: parseFloat(averagePercentage.toFixed(2)),
        },
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'comparar',
        detail: 'al obtener comparativa de períodos',
      });
    }
  }

  async getPaymentStatsByService(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<ServiceStats[]> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // 2.28: ingreso neto real por servicio (antes, precio de lista × nº de
      // pagos: con varios pagos por cita se contaba varias veces y los
      // porcentajes pasaban de 100).
      const rows = await this.serviceRevenue(
        tenantId,
        startDate,
        adjustedEndDate,
      );
      const grandTotal = rows.reduce((sum, row) => sum + row.total_amount, 0);
      const result: ServiceStats[] = rows.map((row) => ({
        service_id: row.service_id,
        service_name: row.service_name,
        appointment_count: row.appointment_count,
        payment_count: row.payment_count,
        total_amount: row.total_amount,
        average_amount:
          row.appointment_count > 0
            ? row.total_amount / row.appointment_count
            : 0,
        percentage_of_total:
          grandTotal > 0 ? (row.total_amount * 100) / grandTotal : 0,
      }));

      // Ordenar por total_amount de mayor a menor
      result.sort((a, b) => b.total_amount - a.total_amount);

      return result;
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por servicio',
      });
    }
  }

  async getPaymentStatsByProfessional(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<ProfessionalStats[]> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // Primero obtenemos el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );

      // Verificar si hay pagos en el período
      if (totalStats.payment_count === 0) {
        return []; // Retornar array vacío si no hay pagos
      }

      // Consulta para estadísticas por profesional
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('professional.id', 'professional_id')
        .addSelect(
          "CONCAT(professional.name, ' ', COALESCE(professional.lastname, ''))",
          'professional_name',
        )
        .addSelect('COUNT(DISTINCT appointment.id)', 'appointment_count')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.professional', 'professional')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .groupBy('professional.id, professional.name, professional.lastname')
        .orderBy('total_amount', 'DESC')
        .getRawMany();

      // Si no se encontraron profesionales
      if (result.length === 0) {
        return [];
      }

      // Procesar y enriquecer los resultados
      return result.map((item) => ({
        professional_id: item.professional_id,
        professional_name: item.professional_name,
        appointment_count: Number(item.appointment_count) || 0,
        payment_count: Number(item.payment_count) || 0.0,
        total_amount: Number(item.total_amount) || 0,
        average_per_payment:
          Number(item.payment_count) > 0
            ? Number(item.total_amount) / Number(item.payment_count)
            : 0,
        percentage_of_total:
          totalStats.total_amount > 0
            ? (Number(item.total_amount) * 100) / totalStats.total_amount
            : 0,
      }));
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por profesional',
      });
    }
  }

  async getPaymentStatsByClient(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    limit: number = 10,
  ): Promise<ClientStats[]> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE)
      startDate = startOfBusinessDay(startDate);
      endDate = endOfBusinessDay(endDate);

      // Consulta para obtener estadísticas básicas por cliente
      const clientsQuery = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('client.id', 'client_id')
        .addSelect(
          "CONCAT(client.name, ' ', COALESCE(client.lastname, ''))",
          'client_name',
        )
        .addSelect('MIN(appointment.date)', 'first_visit_date') // Ajustado a appointment.date
        .addSelect('MAX(appointment.date)', 'last_visit_date') // Ajustado a appointment.date
        .addSelect('COUNT(DISTINCT appointment.id)', 'visit_count')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect(`SUM(${netAmountSql('payment')})`, 'total_spent')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.client', 'client')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('client.id, client.name, client.lastname')
        .orderBy('total_spent', 'DESC')
        .limit(limit)
        .getRawMany();

      // Procesamos los resultados y calculamos métricas adicionales
      return clientsQuery.map((client) => {
        const firstVisit = new Date(client.first_visit_date);
        const lastVisit = new Date(client.last_visit_date);

        // Calculamos la frecuencia promedio (días entre visitas)
        let frequency = 0;
        if (client.visit_count > 1) {
          const daysDiff = Math.floor(
            (lastVisit.getTime() - firstVisit.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          frequency = Math.floor(daysDiff / (client.visit_count - 1));
        }

        return {
          client_id: client.client_id,
          client_name: client.client_name,
          first_visit_date: firstVisit,
          last_visit_date: lastVisit,
          visit_count: Number(client.visit_count) || 0,
          payment_count: Number(client.payment_count) || 0,
          total_spent: Number(client.total_spent) || 0,
          average_per_payment:
            Number(client.payment_count) > 0
              ? Number(client.total_spent) / Number(client.payment_count)
              : 0,
          frequency_days: frequency,
        };
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por cliente',
      });
    }
  }

  async getTopClients(
    startDate: Date,
    endDate: Date,
    tenantId: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      // Días completos del negocio (BUSINESS_TIMEZONE), no de UTC
      startDate = startOfBusinessDay(startDate);
      const adjustedEndDate = endOfBusinessDay(endDate);

      // Consulta SQL nativa simplificada
      const entityManager = this.paymentRepository.manager;
      // Consulta parametrizada: nada del usuario se interpola en el SQL
      const topClients = await entityManager.query(
        `
        SELECT 
          c.id as client_id,
          CONCAT(c.name, ' ', COALESCE(c.lastname, '')) as client_name,
          COUNT(DISTINCT a.id) as visit_count,
          SUM(${netAmountSql('p')}) as total_spent
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN clients c ON a."clientId" = c.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED'
        AND p.created_at BETWEEN $2 AND $3
        GROUP BY c.id, c.name, c.lastname
        ORDER BY total_spent DESC
        LIMIT $4
      `,
        [
          tenantId,
          startDate.toISOString(),
          adjustedEndDate.toISOString(),
          limit,
        ],
      );

      return topClients.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        visit_count: Number(client.visit_count) || 0,
        total_spent: Number(client.total_spent) || 0,
      }));
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener mejores clientes',
      });
    }
  }
}
