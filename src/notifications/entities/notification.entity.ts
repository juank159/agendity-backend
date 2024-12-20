// src/notifications/entities/notification.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ReceiverType {
  USER = 'USER',
  CLIENT = 'CLIENT'
}

export enum NotificationType {
  APPOINTMENT_REMINDER = 'APPOINTMENT_REMINDER',
  APPOINTMENT_CONFIRMATION = 'APPOINTMENT_CONFIRMATION',
  APPOINTMENT_CANCELLATION = 'APPOINTMENT_CANCELLATION',
  NEW_REVIEW = 'NEW_REVIEW',
  PAYMENT_CONFIRMATION = 'PAYMENT_CONFIRMATION',
  GENERAL = 'GENERAL'
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  receiver_id: string;

  @Column({
    type: 'enum',
    enum: ReceiverType
  })
  receiver_type: ReceiverType;

  @Column({
    type: 'enum',
    enum: NotificationType
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