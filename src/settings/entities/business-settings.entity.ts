import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { OpeningHoursRange } from '../opening-hours';

/**
 * Configuración de un negocio (6.01, D-15): una fila por tenant (= id del
 * Owner). Hoy solo la zona horaria; los ajustes nuevos del negocio van aquí
 * como columnas nuevas (con su migración), no en `users`.
 */
@Entity({ name: 'business_settings' })
export class BusinessSettings {
  /** Id del Owner (tenant). Si se borra el Owner, se borra su configuración. */
  @PrimaryColumn('uuid')
  tenant_id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: User;

  /** Zona IANA del negocio (`America/Bogota`), validada con `normalizeTimeZone`. */
  @Column({ type: 'varchar', length: 64 })
  timezone: string;

  /**
   * Nombre del negocio (8.00): texto libre ("Estudio Cejas & Pestañas"). Se
   * pide al registrar al Owner (opcional) y se edita por `PATCH /settings`.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  /**
   * Identificador del link público del negocio (8.00, para la Fase 9):
   * generado del nombre la primera vez que se pone (`slugify` + sufijo si ya
   * existe) y estable después (cambiar el nombre no rompe el link).
   */
  @Column({ type: 'varchar', length: 80, nullable: true, unique: true })
  slug: string | null;

  /**
   * Horario de apertura del negocio (8.01): franjas por día de la semana (ISO,
   * 1 = lunes) en hora de pared de la zona del negocio. `null` = sin configurar
   * (sin límite, como antes); un día sin franjas = cerrado. Ver
   * `settings/opening-hours.ts`.
   */
  @Column({ type: 'jsonb', nullable: true })
  opening_hours: OpeningHoursRange[] | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
