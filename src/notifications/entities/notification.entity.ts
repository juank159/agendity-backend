// src/notifications/entities/notification.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ReceiverType {
  USER = 'USER',
  CLIENT = 'CLIENT',
}

export enum NotificationType {
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION = 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_CANCELLATION = 'APPOINTMENT_CANCELLATION',
  NEW_REVIEW = 'NEW_REVIEW',
  PAYMENT_CONFIRMATION = 'PAYMENT_CONFIRMATION',
  GENERAL = 'GENERAL',
}

@Entity('notifications')
@Index('IDX_sync_notifications', ['ownerId', 'syncVersion'])
export class Notification {
  /**
   * Negocio de la fila (10.01a): lo rellena un trigger de Postgres desde el receptor (usuario o cliente).
   * Solo lo usa la sincronización.
   */
  @Column({
    name: 'owner_id',
    type: 'uuid',
    nullable: true,
    select: false,
    insert: false,
    update: false,
  })
  ownerId?: string;

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

  @Column('uuid')
  receiver_id: string;

  @Column({
    type: 'enum',
    enum: ReceiverType,
  })
  receiver_type: ReceiverType;

  @Column({
    type: 'enum',
    enum: NotificationType,
  })
  type: NotificationType;

  @Column('text')
  title: string;

  @Column('text')
  message: string;

  @Column('boolean', { default: false })
  read: boolean;

  @Column('jsonb', { nullable: true })
  metadata?: Record<string, any>;

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
