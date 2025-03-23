// src/subscriptions/entities/subscription.entity.ts

import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { SubscriptionPlan } from './subscription-plan.entity';
import { PaymentHistory } from './payment-history.entity';

@Entity({ name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: false })
  tenant_id: string;

  @Column({
    type: 'varchar',
    nullable: false,
    default: 'trial',
    enum: ['trial', 'active', 'past_due', 'canceled', 'expired'],
  })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  wompi_customer_id: string; // Cambiado de stripe_customer_id

  @Column({ type: 'varchar', nullable: true })
  wompi_subscription_id: string; // Cambiado de stripe_subscription_id

  @ManyToOne(() => SubscriptionPlan, (plan) => plan.subscriptions, {
    nullable: true,
  })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @Column({ type: 'integer', default: 0 })
  trial_appointments_used: number;

  @Column({ type: 'integer', default: 20 })
  trial_appointments_limit: number;

  @Column({ type: 'timestamp', nullable: true })
  subscription_start_date: Date;

  @Column({ type: 'timestamp', nullable: true })
  subscription_end_date: Date;

  @Column({ type: 'boolean', default: false })
  is_trial_used: boolean;

  @OneToMany(() => PaymentHistory, (payment) => payment.subscription)
  payments: PaymentHistory[];

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
