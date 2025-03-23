// src/subscriptions/entities/payment-history.entity.ts

import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity({ name: 'payment_history' })
export class PaymentHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  tenant_id: string;

  @ManyToOne(() => Subscription, (subscription) => subscription.payments)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  amount: number;

  @Column({ type: 'varchar', nullable: false, default: 'COP' })
  currency: string;

  @Column({
    type: 'varchar',
    nullable: false,
    enum: ['successful', 'failed', 'refunded', 'pending'],
  })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  wompi_transaction_id: string; // Cambiado de stripe_payment_intent_id

  @Column({ type: 'varchar', nullable: true })
  wompi_transaction_url: string; // Cambiado de stripe_invoice_url

  @Column({ type: 'timestamp', nullable: true })
  payment_date: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
