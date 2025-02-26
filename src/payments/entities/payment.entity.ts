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

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
