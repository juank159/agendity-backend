import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  ManyToMany,
  JoinTable,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../users/entities/user.entity';
import { Service } from '../../services/entities/service.entity';
import { TimeBlock } from 'src/time-blocks/entities/time-block.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { Review } from 'src/reviews/entities/review.entity';
import { AppointmentStatus, PaymentStatus } from 'src/common/enums/status.enum';

@Entity('appointments')
// Lo usa el cron de recordatorios (2.09a) y cualquier consulta por rango de fechas.
@Index('IDX_appointments_date', ['date'])
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: false })
  ownerId: string;

  @ManyToOne(() => Client, (client) => client.appointments)
  client: Client;

  @Column({ name: 'professional_id', type: 'uuid' })
  professionalId: string;

  @ManyToOne(() => User, (user) => user.appointments)
  @JoinColumn({ name: 'professional_id' })
  professional: User;

  @ManyToMany(() => Service, (service) => service.appointments)
  @JoinTable({
    name: 'appointment_services',
    joinColumn: {
      name: 'appointment_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'service_id',
      referencedColumnName: 'id',
    },
  })
  services: Service[];

  @Column('timestamptz', { name: 'date' })
  date: Date;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    name: 'status',
    default: AppointmentStatus.PENDING,
  })
  status: AppointmentStatus;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    name: 'payment_status',
    default: PaymentStatus.PENDING,
  })
  payment_status: PaymentStatus;

  @Column({ name: 'total_price', type: 'numeric' })
  total_price: number;

  @Column('text', { nullable: true, name: 'notes' })
  notes?: string;

  @Column('text', { nullable: true, name: 'cancellation_reason' })
  cancellation_reason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at: Date;

  @Column('boolean', { default: false, name: 'reminder_sent' })
  reminderSent: boolean;

  @Column('timestamptz', { nullable: true, name: 'reminder_sent_at' })
  reminderSentAt: Date;

  @Column('boolean', { default: true, name: 'send_reminder' })
  sendReminder: boolean;

  /**
   * Fecha de la cita para la que el cron ya procesó el recordatorio automático
   * (2.09a). Si la cita se mueve, deja de coincidir con `date` y vuelve a
   * tocar. Interno: no sale en las respuestas. No confundir con
   * `reminderSent`, que es el recordatorio MANUAL al cliente (`wa.me`).
   */
  @Column('timestamptz', {
    nullable: true,
    name: 'auto_reminder_for',
    select: false,
  })
  autoReminderFor?: Date | null;

  @OneToOne(() => TimeBlock, (timeBlock) => timeBlock.appointment)
  timeBlock: TimeBlock;

  @OneToMany(() => Payment, (payment) => payment.appointment)
  payments: Payment[];

  @OneToMany(() => Review, (review) => review.appointment)
  reviews: Review[];
}
