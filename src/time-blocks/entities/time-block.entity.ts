import { BadRequestException } from '@nestjs/common';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ERROR_MESSAGES } from '../constants/time-block.constants';

@Entity()
@Index('IDX_sync_time_block', ['ownerId', 'syncVersion'])
export class TimeBlock {
  /**
   * Negocio de la fila (10.01a): lo rellena un trigger de Postgres desde el profesional (`userId`).
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

  @Column({ type: 'timestamptz' })
  start_datetime: Date;

  @Column({ type: 'timestamptz' })
  end_datetime: Date;

  /**
   * Zona IANA del negocio con la que se creó (o movió) el bloqueo (6.03, D-15): si el negocio
   * cambia de zona después, este registro conserva la suya. La fija el
   * service desde `TenantSettingsService.getTimezone`; sale en las respuestas.
   */
  @Column({ type: 'varchar', length: 64, name: 'timezone' })
  timezone: string;

  @Column({ nullable: true })
  notes?: string;

  /** Desde 10.01a (D-18): el bloqueo no tenía fechas de alta ni de cambio. */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => Appointment, { nullable: true })
  appointment?: Appointment;

  static validateDateRange(start: Date, end: Date): void {
    if (start >= end) {
      throw new BadRequestException(ERROR_MESSAGES.INVALID_DATE_RANGE);
    }
  }

  update(props: Partial<TimeBlock>): void {
    if (props.start_datetime && props.end_datetime) {
      TimeBlock.validateDateRange(props.start_datetime, props.end_datetime);
    }
    Object.assign(this, props);
  }
}
