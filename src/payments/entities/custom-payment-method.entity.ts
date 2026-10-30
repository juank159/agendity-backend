// src/payments/entities/custom-payment-method.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('custom_payment_methods')
@Index('IDX_sync_custom_payment_methods', ['ownerId', 'syncVersion'])
export class CustomPaymentMethod {
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

  @Column({ length: 100 })
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column({ nullable: true })
  icon: string;

  @Column({ default: true })
  isActive: boolean;

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
