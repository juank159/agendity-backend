import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppointmentStatus, PaymentStatus } from '../common/enums/status.enum';
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

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
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

  private async validateExistingPayment(appointmentId: string): Promise<void> {
    const existingPayment = await this.paymentRepository.findOne({
      where: {
        appointment: { id: appointmentId },
        status: PaymentStatus.COMPLETED,
      },
    });

    if (existingPayment) {
      throw new BadRequestException(
        'Ya existe un pago completado para esta cita',
      );
    }
  }

  async create(
    createPaymentDto: CreatePaymentDto,
    userId: string,
  ): Promise<Payment> {
    try {
      const appointment = await this.appointmentsService.findOne(
        createPaymentDto.appointment_id,
        userId,
      );

      await this.validateExistingPayment(appointment.id);

      // Validar que exista un método de pago válido
      if (
        !createPaymentDto.payment_method &&
        !createPaymentDto.custom_payment_method_id
      ) {
        throw new BadRequestException(
          'Debe especificar un método de pago estándar o personalizado',
        );
      }

      // Si es un método personalizado, verificar que exista
      let customPaymentMethod = null;
      if (createPaymentDto.custom_payment_method_id) {
        customPaymentMethod = await this.customPaymentMethodsService.findOne(
          createPaymentDto.custom_payment_method_id,
          userId,
        );

        if (!customPaymentMethod.isActive) {
          throw new BadRequestException(
            'El método de pago seleccionado está inactivo',
          );
        }
      }

      const payment = this.paymentRepository.create({
        amount: createPaymentDto.amount,
        payment_method: createPaymentDto.payment_method,
        custom_payment_method_id: createPaymentDto.custom_payment_method_id,
        transaction_id: createPaymentDto.transaction_id,
        payment_details: createPaymentDto.payment_details,
        appointment,
        status: PaymentStatus.COMPLETED,
        ownerId: userId,
      });

      const savedPayment = await this.paymentRepository.save(payment);

      // Actualizar el estado de la cita
      await this.appointmentsService.update(
        appointment.id,
        {
          status: AppointmentStatus.CONFIRMED,
          payment_status: PaymentStatus.COMPLETED,
        },
        userId,
      );

      await this.sendPaymentNotification({
        receiver_id: appointment.client.id,
        payment_amount: payment.amount,
        appointment_id: appointment.id,
        payment_id: savedPayment.id,
      });

      return savedPayment;
    } catch (error) {
      this.handleError(error, {
        entity: 'el pago',
        operation: 'crear',
      });
    }
  }

  async findAll(userId: string): Promise<Payment[]> {
    try {
      return await this.paymentRepository.find({
        where: { ownerId: userId },
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
    userId: string,
  ): Promise<Payment[]> {
    try {
      await this.appointmentsService.findOne(appointmentId, userId);

      return await this.paymentRepository.find({
        where: {
          appointment: { id: appointmentId },
          ownerId: userId,
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

  async findOne(id: string, userId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: {
        id,
        ownerId: userId,
      },
      relations: RELATIONS.APPOINTMENT,
    });

    if (!payment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado`);
    }

    return payment;
  }

  async refund(
    id: string,
    refundDto: RefundPaymentDto,
    userId: string,
  ): Promise<Payment> {
    try {
      const payment = await this.findOne(id, userId);

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new BadRequestException(
          'Solo se pueden reembolsar pagos completados',
        );
      }

      if (refundDto.refund_amount > payment.amount) {
        throw new BadRequestException(
          'El monto del reembolso no puede ser mayor al pago original',
        );
      }

      payment.status = PaymentStatus.REFUNDED;
      payment.refund_amount = refundDto.refund_amount;
      payment.refund_reason = refundDto.refund_reason;

      const refundedPayment = await this.paymentRepository.save(payment);

      // Actualizar el estado de la cita cuando se hace un reembolso
      await this.appointmentsService.update(
        payment.appointment.id,
        {
          payment_status: PaymentStatus.REFUNDED,
        },
        userId,
      );

      await this.sendPaymentNotification(
        {
          receiver_id: payment.appointment.client.id,
          payment_amount: refundDto.refund_amount,
          appointment_id: payment.appointment.id,
          payment_id: payment.id,
        },
        true,
      );

      return refundedPayment;
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
    userId: string,
  ): Promise<PaymentStats> {
    try {
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .select('SUM(payment.amount)', 'total_amount')
        .addSelect('COUNT(*)', 'payment_count')
        .addSelect('AVG(payment.amount)', 'average_amount')
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

  async getPaymentStatsByMethod(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<PaymentMethodStats[]> {
    try {
      // Obtener total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(startDate, endDate, userId);

      // Consulta para métodos estándar
      const standardMethodsQuery = this.paymentRepository
        .createQueryBuilder('payment')
        .select('payment.payment_method', 'method')
        .addSelect("'STANDARD'", 'method_type')
        .addSelect('COUNT(*)', 'count')
        .addSelect('SUM(payment.amount)', 'total')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .andWhere('payment.payment_method IS NOT NULL')
        .groupBy('payment.payment_method');

      // Consulta para métodos personalizados
      const customMethodsQuery = this.paymentRepository
        .createQueryBuilder('payment')
        .select('custom.name', 'method')
        .addSelect("'CUSTOM'", 'method_type')
        .addSelect('COUNT(*)', 'count')
        .addSelect('SUM(payment.amount)', 'total')
        .innerJoin('payment.custom_payment_method', 'custom')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .andWhere('payment.custom_payment_method_id IS NOT NULL')
        .groupBy('custom.name');

      // Ejecutar consultas
      const standardResults = await standardMethodsQuery.getRawMany();
      const customResults = await customMethodsQuery.getRawMany();

      // Combinar y procesar resultados
      const results = [...standardResults, ...customResults].map((item) => ({
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
    userId: string,
  ): Promise<PaymentComparisonStats> {
    try {
      // Calcular la duración del período actual en milisegundos
      const periodDuration = endDate.getTime() - startDate.getTime();

      // Calcular fechas para el período anterior (mismo rango de tiempo)
      const previousEndDate = new Date(startDate.getTime() - 1); // Un milisegundo antes del inicio del período actual
      const previousStartDate = new Date(
        previousEndDate.getTime() - periodDuration,
      );

      // Obtener estadísticas para ambos períodos
      const currentStats = await this.getPaymentStats(
        startDate,
        endDate,
        userId,
      );
      const previousStats = await this.getPaymentStats(
        previousStartDate,
        previousEndDate,
        userId,
      );

      // Calcular diferencias y cambios porcentuales
      const amountDifference =
        currentStats.total_amount - previousStats.total_amount;
      const amountPercentage =
        previousStats.total_amount !== 0
          ? (amountDifference * 100) / previousStats.total_amount
          : currentStats.total_amount > 0
            ? 100
            : 0; // Si el período anterior es 0, considerar 100% de aumento si hay ingresos

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
          end_date: endDate,
          total_amount: currentStats.total_amount,
          payment_count: currentStats.payment_count,
          average_amount: currentStats.average_amount,
        },
        previous_period: {
          start_date: previousStartDate,
          end_date: previousEndDate,
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
    userId: string,
  ): Promise<ServiceStats[]> {
    try {
      // Primero obtenemos el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(startDate, endDate, userId);

      // Consulta para obtener estadísticas por servicio
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('service.id', 'service_id')
        .addSelect('service.name', 'service_name')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect('SUM(payment.amount)', 'total_amount')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.services', 'service')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('service.id, service.name')
        .orderBy('total_amount', 'DESC')
        .getRawMany();

      // Procesar y enriquecer los resultados
      return result.map((item) => ({
        service_id: item.service_id,
        service_name: item.service_name,
        payment_count: Number(item.payment_count) || 0,
        total_amount: Number(item.total_amount) || 0,
        average_amount:
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
        detail: 'al obtener estadísticas por servicio',
      });
    }
  }

  async getPaymentStatsByProfessional(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<ProfessionalStats[]> {
    try {
      // Primero obtenemos el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(startDate, endDate, userId);

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
        .addSelect('SUM(payment.amount)', 'total_amount')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.professional', 'professional')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('professional.id, professional.name, professional.lastname')
        .orderBy('total_amount', 'DESC')
        .getRawMany();

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
    userId: string,
    limit: number = 10,
  ): Promise<ClientStats[]> {
    try {
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
        .addSelect('SUM(payment.amount)', 'total_spent')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.client', 'client')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
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

  // Método adicional para obtener los "top clients"
  async getTopClients(
    startDate: Date,
    endDate: Date,
    userId: string,
    limit: number = 5,
  ): Promise<
    Pick<
      ClientStats,
      'client_id' | 'client_name' | 'total_spent' | 'visit_count'
    >[]
  > {
    try {
      // Consulta simplificada para obtener los mejores clientes
      const topClients = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('client.id', 'client_id')
        .addSelect(
          "CONCAT(client.name, ' ', COALESCE(client.lastname, ''))",
          'client_name',
        )
        .addSelect('COUNT(DISTINCT appointment.id)', 'visit_count')
        .addSelect('SUM(payment.amount)', 'total_spent')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.client', 'client')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('client.id, client.name, client.lastname')
        .orderBy('total_spent', 'DESC')
        .limit(limit)
        .getRawMany();

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
