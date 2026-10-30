import {
  Entity,
  Column,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Service } from 'src/services/entities/service.entity';

@Entity('user_services')
@Index('IDX_sync_user_services', ['ownerId', 'syncVersion'])
export class UserService {
  /**
   * Negocio de la fila (10.01a): lo rellena un trigger de Postgres desde el profesional (`user_id`).
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

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  customPrice: number;

  /**
   * Excepción de comisión del profesional en ESTE servicio (8.02, D-16).
   * `null` = sin excepción: se usa su comisión general
   * (`users.commission_percentage`). `0` = 0 % de verdad.
   */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  commissionPercentage: number | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @ManyToOne(() => User, (user) => user.userServices)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Service, (service) => service.userServices)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
