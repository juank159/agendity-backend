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
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-codes';
import {
  applyRefund,
  assertPaymentAmount,
  fromCents,
  netAmountSql,
  PAYMENT_ALREADY_EXISTS_MESSAGE,
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
import { ServiceStats } from './interfaces/service-stats.interface';
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
   * Regla: un único pago COMPLETED por cita. Se llama DENTRO de la transacción
   * del pago y con la cita bloqueada (`lockAppointment`): dos pagos simultáneos
   * a la misma cita se serializan y el segundo ya ve el primero.
   */
  private async assertNoCompletedPayment(
    manager: EntityManager,
    appointmentId: string,
  ): Promise<void> {
    const existingPayment = await manager.getRepository(Payment).findOne({
      where: {
        appointment: { id: appointmentId },
        status: PaymentStatus.COMPLETED,
      },
    });

    if (existingPayment) {
      // 409 directo (2.23): la app (payments, 4.02) decide por `code` y por
      // tipo de failure, no por el 400 ni por el texto, que se conserva.
      throw new BusinessException(
        ErrorCode.PAYMENT_ALREADY_EXISTS,
        PAYMENT_ALREADY_EXISTS_MESSAGE,
      );
    }
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
   * Registra un pago COMPLETED (2.06), en UNA transacción:
   * 1. Cita del negocio con lock de fila (ajena = 404).
   * 2. La cita no puede estar CANCELLED (`INVALID_STATE_TRANSITION`).
   * 3. Un único pago COMPLETED por cita.
   * 4. Monto > 0 y sin superar el total de la cita.
   * 5. Inserta el pago y aplica la máquina de estados (PENDING → CONFIRMED,
   *    `payment_status` = COMPLETED).
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
          await this.assertNoCompletedPayment(manager, locked.id);
          assertPaymentAmount(createPaymentDto.amount, locked.total_price);

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
          // PENDING → CONFIRMED (máquina de estados) y payment_status COMPLETED.
          await this.appointmentsService.applyPaymentStatus(
            manager,
            locked,
            PaymentStatus.COMPLETED,
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
   * Reembolso parcial o total (2.06), en UNA transacción con locks en orden
   * cita → pago (el mismo que crear un pago). Los reembolsos se acumulan en
   * `refund_amount`: mientras quede saldo el pago sigue COMPLETED (y la cita
   * con `payment_status` COMPLETED); al devolver todo, ambos pasan a REFUNDED.
   * El estado de la cita (`status`) no cambia.
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
        if (status === PaymentStatus.REFUNDED) {
          await this.appointmentsService.applyPaymentStatus(
            manager,
            locked,
            PaymentStatus.REFUNDED,
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

      // Desglose por servicio
      let serviceBreakdown = [];
      try {
        serviceBreakdown = await this.paymentRepository.manager.query(
          `
        SELECT 
          s.id as service_id,
          s.name as service_name,
          COUNT(*) as service_count,
          SUM(s.price) as service_total
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN appointment_services aps ON a.id = aps.appointment_id
        JOIN services s ON aps.service_id = s.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED'
        AND a."professional_id" = $2
        AND p.created_at BETWEEN $3 AND $4
        GROUP BY s.id, s.name
        ORDER BY service_total DESC
      `,
          [
            tenantId,
            professionalId,
            startDate.toISOString(),
            adjustedEndDate.toISOString(),
          ],
        );
      } catch (serviceError) {
        this.logger.error(
          `Estadísticas del profesional: falló el desglose por servicio: ${serviceError?.message}`,
        );
        serviceBreakdown = [];
      }

      // Consultar evolución diaria con query nativo
      let dailyStats = [];
      try {
        dailyStats = await this.paymentRepository.manager.query(
          `
        SELECT 
          to_char(p.created_at AT TIME ZONE $5::text, 'YYYY-MM-DD') as date,
          SUM(${netAmountSql('p')}) as daily_total,
          COUNT(DISTINCT p.id) as daily_count
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
        by_service: serviceBreakdown.map((item) => ({
          service_id: item.service_id,
          service_name: item.service_name,
          count: Number(item.service_count || 0),
          total: Number(item.service_total || 0),
        })),
        daily_evolution: dailyStats.map((item) => ({
          date: item.date,
          total: Number(item.daily_total || 0),
          count: Number(item.daily_count || 0),
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

      // Obtener el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );

      // Consulta para pagos con métodos estándar
      const standardMethodsQuery = this.paymentRepository
        .createQueryBuilder('payment')
        .select('payment.payment_method', 'method')
        .addSelect("'STANDARD'", 'method_type')
        .addSelect('COUNT(*)', 'count')
        .addSelect(`SUM(${netAmountSql('payment')})`, 'total')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .andWhere('payment.payment_method IS NOT NULL')
        .groupBy('payment.payment_method');

      // Hacer la consulta para métodos estándar
      const standardResults = await standardMethodsQuery.getRawMany();

      // Transformar los resultados
      const results = standardResults.map((item) => ({
        method: item.method,
        method_type: item.method_type,
        count: Number(item.count) || 0,
        total: Number(item.total) || 0,
        average:
          Number(item.count) > 0 ? Number(item.total) / Number(item.count) : 0,
        percentage:
          totalStats.total_amount > 0
            ? (Number(item.total) * 100) / totalStats.total_amount
            : 0,
      }));

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

      // Obtener el total general de pagos para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );

      // Obtener servicios con sus precios
      const servicesWithPrices = await this.paymentRepository.manager
        .createQueryBuilder()
        .select('s.id', 'id')
        .addSelect('s.name', 'name')
        .addSelect('s.price', 'price')
        .from('services', 's')
        .where('s.ownerId = :tenantId', { tenantId })
        .getRawMany();

      // Crear un mapa de precios de servicios
      const servicePrices = {};
      for (const service of servicesWithPrices) {
        servicePrices[service.id] = Number(service.price) || 0;
      }

      // Consulta SQL para contar servicios y frecuencia
      const entityManager = this.paymentRepository.manager;
      const query = `
        SELECT 
          s.id as service_id,
          s.name as service_name,
          COUNT(*) as usage_count
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN appointment_services aps ON a.id = aps.appointment_id
        JOIN services s ON aps.service_id = s.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED'
        AND p.created_at BETWEEN $2 AND $3
        GROUP BY s.id, s.name
        ORDER BY usage_count DESC
      `;

      const serviceUsage = await entityManager.query(query, [
        tenantId,
        startDate.toISOString(),
        adjustedEndDate.toISOString(),
      ]);

      // Procesar los resultados utilizando los precios de los servicios
      const result = serviceUsage.map((item) => {
        const serviceId = item.service_id;
        const usageCount = Number(item.usage_count) || 0;
        const price = servicePrices[serviceId] || 0;
        const totalAmount = price * usageCount;

        return {
          service_id: serviceId,
          service_name: item.service_name,
          payment_count: usageCount,
          total_amount: totalAmount,
          average_amount: price,
          percentage_of_total:
            totalStats.total_amount > 0
              ? (totalAmount * 100) / totalStats.total_amount
              : 0,
        };
      });

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
