import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Configuración de recordatorios automáticos de un negocio (Fase 11.01). Sin
 * fila = apagados, con la ventana por defecto. Horas `HH:mm` en la zona del
 * negocio (`business_settings.timezone`).
 */
@Entity('reminder_settings')
export class ReminderSettings {
  @PrimaryColumn('uuid')
  tenant_id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: User;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** Inicio de la ventana de envío (incluido). */
  @Column({ type: 'varchar', length: 5, default: '08:00' })
  send_window_start: string;

  /** Fin de la ventana de envío (excluido). */
  @Column({ type: 'varchar', length: 5, default: '20:00' })
  send_window_end: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
