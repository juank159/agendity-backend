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

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
