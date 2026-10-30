// src/payments/entities/payment.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { PaymentMethod, PaymentStatus } from 'src/common/enums/status.enum';
import { CustomPaymentMethod } from './custom-payment-method.entity';

@Entity('payments')
@Index('IDX_sync_payments', ['ownerId', 'syncVersion'])
export class Payment {
  /**
   * Versión de sincronización (10.01a, D-18): la pone un trigger de Postgres
   * (`sync_bump`) en cada INSERT/UPDATE; el código nunca la escribe ni la lee
   * fuera de `SyncService`.
   */
  @Column({
    name: 'sync_version',
    type: 'bigint',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  syncVersion?: string;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid', nullable: false })
  ownerId: string;

  @ManyToOne(() => Appointment, (appointment) => appointment.payments)
  appointment: Appointment;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
    nullable: true,
  })
  payment_method: PaymentMethod;

  @Column({ nullable: true })
  custom_payment_method_id: string;

  @ManyToOne(() => CustomPaymentMethod, { nullable: true })
  @JoinColumn({ name: 'custom_payment_method_id' })
  custom_payment_method: CustomPaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column('text', { nullable: true })
  transaction_id?: string;

  @Column('jsonb', { nullable: true })
  payment_details?: Record<string, any>;

  @Column('text', { nullable: true })
  refund_reason?: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  refund_amount?: number;

  /**
   * Zona IANA del negocio con la que se registró el pago (6.03, D-15): si el negocio
   * cambia de zona después, este registro conserva la suya. La fija el
   * service desde `TenantSettingsService.getTimezone`; sale en las respuestas.
   */
  @Column({ type: 'varchar', length: 64, name: 'timezone' })
  timezone: string;

  // Instantes reales (now() de la BD). Hasta 2.05 se guardaban desplazados
  // -5/-6 h por un "parche" de zona horaria; la migración 2.05 los corrigió.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updated_at: Date;
}
