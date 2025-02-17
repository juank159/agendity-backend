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

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
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

      const payment = this.paymentRepository.create({
        ...createPaymentDto,
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
        relations: RELATIONS.APPOINTMENT,
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
}
