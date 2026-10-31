import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Client } from '../../clients/entities/client.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { ReminderRule } from './reminder-rule.entity';
import type {
  DeliveryStatus,
  ReminderCategory,
  ReminderKind,
} from '../reminder-kinds';

/**
 * Registro de envíos (Fase 11.02). Idempotente: una fila por regla, objetivo
 * (cita o cliente) y ocurrencia (`UQ_reminder_deliveries_once`); el cron puede
 * correr dos veces sin duplicar. Estados: `queued → sent → delivered → read`;
 * `failed` y `skipped` (con `reason`) son finales.
 */
@Entity('reminder_deliveries')
@Index('UQ_reminder_deliveries_once', ['ruleId', 'targetId', 'occurrenceKey'], {
  unique: true,
})
@Index('IDX_reminder_deliveries_due', ['status', 'nextAttemptAt'])
@Index('IDX_reminder_deliveries_owner', ['ownerId', 'createdAt'])
export class ReminderDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  ruleId: string | null;

  @ManyToOne(() => ReminderRule, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'rule_id' })
  rule?: ReminderRule | null;

  @Column({ type: 'varchar', length: 20 })
  kind: ReminderKind;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  /** Borrar al cliente borra su historial (Ley 1581). */
  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: Client | null;

  @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
  appointmentId: string | null;

  @ManyToOne(() => Appointment, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'appointment_id' })
  appointment?: Appointment | null;

  /** Cita (recordatorio, mantenimiento) o cliente (cumpleaños, te extrañamos). */
  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  /** Fecha de la cita, servicio del mantenimiento, año del cumpleaños o última visita. */
  @Column({ name: 'occurrence_key', type: 'varchar', length: 64 })
  occurrenceKey: string;

  @Column({ type: 'varchar', length: 12, default: 'queued' })
  status: DeliveryStatus;

  @Column({ type: 'varchar', length: 40, nullable: true })
  reason: string | null;

  /** Cuándo tocaba según la regla (antes de aplicar la ventana). */
  @Column({ name: 'scheduled_for', type: 'timestamptz' })
  scheduledFor: Date;

  /** Próximo intento (ventana, backoff o lease del envío). */
  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'varchar', length: 10 })
  category: ReminderCategory;

  /** E.164, el que se usó (o se intentó usar). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  /** Texto renderizado con la plantilla del negocio. */
  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({
    name: 'template_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  templateName: string | null;

  @Column({
    name: 'provider_message_id',
    type: 'varchar',
    length: 128,
    nullable: true,
    unique: true,
  })
  providerMessageId: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
