import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  AfterLoad,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { User } from '../../users/entities/user.entity';
import { Exclude } from 'class-transformer';
import { Service } from '../../services/entities/service.entity';
import { AppointmentServiceLine } from './appointment-service-line.entity';
import { TimeBlock } from 'src/time-blocks/entities/time-block.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { Review } from 'src/reviews/entities/review.entity';
import {
  AppointmentPaymentStatus,
  AppointmentStatus,
} from 'src/common/enums/status.enum';

/** Un servicio en la respuesta de una cita, con el precio cobrado en ella. */
export type AppointmentServiceView = Service & { appointment_price: string };

export function withAppointmentPrice(
  service: Service,
  price: string,
): AppointmentServiceView {
  return Object.assign(service, { appointment_price: price });
}

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

  /**
   * Servicios de la cita con su precio guardado (2.29). Interno: en las
   * respuestas sale `services` (lo arma `exposeServices`).
   */
  @OneToMany(() => AppointmentServiceLine, (line) => line.appointment, {
    cascade: ['insert'],
  })
  @Exclude({ toPlainOnly: true })
  serviceLines: AppointmentServiceLine[];

  /**
   * Servicios de la cita tal como los lee la app (`id`, `name`, `duration`,
   * `color`…), cada uno con `appointment_price`: el precio cobrado en ESTA
   * cita (2.29), que puede diferir del `price` actual del servicio. Solo existe
   * si se cargó `serviceLines.service` (no es una columna).
   */
  services?: AppointmentServiceView[];

  @AfterLoad()
  exposeServices(): void {
    if (this.serviceLines?.every((line) => line.service)) {
      this.services = this.serviceLines.map((line) =>
        withAppointmentPrice(line.service, line.price),
      );
    }
  }

  /**
   * Zona IANA del negocio con la que se agendó (o movió por última vez) la cita (6.03, D-15): si el negocio
   * cambia de zona después, este registro conserva la suya. La fija el
   * service desde `TenantSettingsService.getTimezone`; sale en las respuestas.
   */
  @Column({ type: 'varchar', length: 64, name: 'timezone' })
  timezone: string;

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
    enum: AppointmentPaymentStatus,
    name: 'payment_status',
    default: AppointmentPaymentStatus.PENDING,
  })
  payment_status: AppointmentPaymentStatus;

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
