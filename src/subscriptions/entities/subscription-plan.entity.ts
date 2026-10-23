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
  billing_interval: string; // 'month' o 'year' - para compatibilidad con código existente

  @Column({ type: 'integer', nullable: false, default: 1 })
  duration_months: number; // Nuevo campo: 1 para mensual, 6 para semestral, 12 para anual

  @Column({ type: 'boolean', default: false })
  is_recurring: boolean; // Nuevo campo: true si es cobro recurrente, false si es pago único

  @Column({ type: 'integer', nullable: false, default: -1 })
  appointment_limit: number; // -1 significa ilimitado

  @Column({ type: 'varchar', nullable: true })
  wompi_price_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'simple-array', nullable: true })
  features: string[]; // Nuevo campo: array de características para mostrar en frontend

  @OneToMany(() => Subscription, (subscription) => subscription.plan)
  subscriptions: Subscription[];

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
