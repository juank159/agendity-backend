// src/subscriptions/entities/subscription-plan.entity.ts

import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity({ name: 'subscription_plans' })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: false })
  name: string;

  @Column({ type: 'varchar', nullable: false })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false })
  price: number;

  @Column({ type: 'varchar', nullable: false, default: 'COP' })
  currency: string;

  @Column({ type: 'varchar', nullable: false, default: 'month' })
  billing_interval: string; // 'month' o 'year'

  @Column({ type: 'integer', nullable: false, default: -1 })
  appointment_limit: number; // -1 significa ilimitado

  @Column({ type: 'varchar', nullable: true })
  wompi_price_id: string; // Cambiado de stripe_price_id a wompi_price_id

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
