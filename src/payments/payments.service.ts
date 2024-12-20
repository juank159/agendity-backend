import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, ReceiverType } from '../notifications/entities/notification.entity';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(createPaymentDto: CreatePaymentDto): Promise<Payment> {
    const appointment = await this.appointmentsService.findOne(createPaymentDto.appointment_id);

    // Verificar si ya existe un pago completado para esta cita
    const existingPayment = await this.paymentRepository.findOne({
      where: {
        appointment: { id: appointment.id },
        status: PaymentStatus.COMPLETED
      }
    });

    if (existingPayment) {
      throw new BadRequestException('Ya existe un pago completado para esta cita');
    }

    const payment = this.paymentRepository.create({
      ...createPaymentDto,
      appointment,
      status: PaymentStatus.COMPLETED
    });

    const savedPayment = await this.paymentRepository.save(payment);

    // Enviar notificación al cliente
    await this.notificationsService.create({
      receiver_id: appointment.client.id,
      receiver_type: ReceiverType.CLIENT,
      type: NotificationType.PAYMENT_CONFIRMATION,
      title: 'Pago Confirmado',
      message: `Tu pago de $${payment.amount} ha sido procesado exitosamente`,
      metadata: {
        appointment_id: appointment.id,
        payment_id: savedPayment.id
      }
    });

    return savedPayment;
  }

  async findAll(): Promise<Payment[]> {
    return await this.paymentRepository.find({
      relations: ['appointment', 'appointment.client', 'appointment.professional']
    });
  }

  async findByAppointment(appointmentId: string): Promise<Payment[]> {
    return await this.paymentRepository.find({
      where: { appointment: { id: appointmentId } },
      relations: ['appointment']
    });
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: { id },
      relations: ['appointment', 'appointment.client', 'appointment.professional']
    });

    if (!payment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado`);
    }

    return payment;
  }

  async refund(id: string, refundDto: RefundPaymentDto): Promise<Payment> {
    const payment = await this.findOne(id);

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Solo se pueden reembolsar pagos completados');
    }

    if (refundDto.refund_amount > payment.amount) {
      throw new BadRequestException('El monto del reembolso no puede ser mayor al pago original');
    }

    payment.status = PaymentStatus.REFUNDED;
    payment.refund_amount = refundDto.refund_amount;
    payment.refund_reason = refundDto.refund_reason;

    const refundedPayment = await this.paymentRepository.save(payment);

    // Enviar notificación al cliente
    await this.notificationsService.create({
      receiver_id: payment.appointment.client.id,
      receiver_type: ReceiverType.CLIENT,
      type: NotificationType.PAYMENT_CONFIRMATION,
      title: 'Reembolso Procesado',
      message: `Se ha procesado un reembolso de $${refundDto.refund_amount}`,
      metadata: {
        appointment_id: payment.appointment.id,
        payment_id: payment.id
      }
    });

    return refundedPayment;
  }

  async getPaymentStats(startDate: Date, endDate: Date): Promise<{
    total_amount: number;
    payment_count: number;
    average_amount: number;
  }> {
    const result = await this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
      .andWhere('payment.created_at BETWEEN :startDate AND :endDate', { startDate, endDate })
      .select('SUM(payment.amount)', 'total_amount')
      .addSelect('COUNT(*)', 'payment_count')
      .addSelect('AVG(payment.amount)', 'average_amount')
      .getRawOne();

    return {
      total_amount: Number(result.total_amount) || 0,
      payment_count: Number(result.payment_count) || 0,
      average_amount: Number(result.average_amount) || 0
    };
  }
}