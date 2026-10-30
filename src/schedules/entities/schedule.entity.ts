import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('schedules')
@Index('IDX_sync_schedules', ['ownerId', 'syncVersion'])
export class Schedule {
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

  @ManyToOne(() => User, (user) => user.schedules)
  user: User;

  @Column('int')
  day_of_week: number; // 1-7 (Lunes a Domingo)

  @Column('time')
  start_time: string;

  @Column('time')
  end_time: string;

  @Column('boolean', { default: true })
  is_available: boolean;

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
