// import {
//   Entity,
//   Column,
//   PrimaryGeneratedColumn,
//   ManyToOne,
//   CreateDateColumn,
//   UpdateDateColumn,
// } from 'typeorm';
// import { Appointment } from '../../appointments/entities/appointment.entity';
// import { PaymentMethod, PaymentStatus } from 'src/common/enums/status.enum';

// @Entity('payments')
// export class Payment {
//   @PrimaryGeneratedColumn('uuid')
//   id: string;

//   @Column({ name: 'owner_id', type: 'uuid', nullable: false })
//   ownerId: string;

//   @ManyToOne(() => Appointment, (appointment) => appointment.payments)
//   appointment: Appointment;

//   @Column('decimal', { precision: 10, scale: 2 })
//   amount: number;

//   @Column({
//     type: 'enum',
//     enum: PaymentMethod,
//   })
//   payment_method: PaymentMethod;

//   @Column({
//     type: 'enum',
//     enum: PaymentStatus,
//     default: PaymentStatus.PENDING,
//   })
//   status: PaymentStatus;

//   @Column('text', { nullable: true })
//   transaction_id?: string;

//   @Column('jsonb', { nullable: true })
//   payment_details?: Record<string, any>;

//   @Column('text', { nullable: true })
//   refund_reason?: string;

//   @Column('decimal', { precision: 10, scale: 2, nullable: true })
//   refund_amount?: number;

//   @CreateDateColumn({
//     type: 'timestamptz',
//     default: () => 'CURRENT_TIMESTAMP',
//   })
//   created_at: Date;

//   @UpdateDateColumn({
//     type: 'timestamptz',
//     default: () => 'CURRENT_TIMESTAMP',
//   })
//   updated_at: Date;
// }

// src/payments/entities/payment.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  BeforeInsert,
} from 'typeorm';
import { Appointment } from '../../appointments/entities/appointment.entity';
import { PaymentMethod, PaymentStatus } from 'src/common/enums/status.enum';
import { CustomPaymentMethod } from './custom-payment-method.entity';

@Entity('payments')
export class Payment {
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

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    //default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamptz',
    //default: () => 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @BeforeInsert()
  setCreatedAt() {
    // Crear fecha explícitamente en tu zona horaria
    const now = new Date();

    // Opción 1: Ajustar la hora para tu zona horaria (GMT-6)
    // Importante: cambia el -6 a tu offset correcto
    const offset = -6; // Para GMT-6
    const utcDate = new Date(now.getTime() + offset * 60 * 60 * 1000);

    this.created_at = utcDate;
    this.updated_at = utcDate;

    console.log('Fecha configurada en entidad:', this.created_at);
  }
}
