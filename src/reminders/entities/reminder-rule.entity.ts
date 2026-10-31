import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { ReminderCategory, ReminderKind } from '../reminder-kinds';

/**
 * Regla de recordatorio automático de un negocio (Fase 11.01).
 *
 * - `before_appointment`: `minutes_before` antes de la cita (varias reglas).
 * - `maintenance`: `services.maintenance_days` después de una cita
 *   completada, a la `send_time`.
 * - `birthday`: el día del cumpleaños, a la `send_time`.
 * - `win_back`: `days_without_visit` días sin visitas, a la `send_time`.
 *
 * `template` admite `{cliente}`, `{negocio}`, `{servicio}`, `{fecha}`,
 * `{hora}`, `{profesional}` y `{link_reserva}`.
 */
@Entity('reminder_rules')
@Index('UQ_reminder_rules_before', ['ownerId', 'minutes_before'], {
  unique: true,
  where: `"kind" = 'before_appointment'`,
})
@Index('UQ_reminder_rules_kind', ['ownerId', 'kind'], {
  unique: true,
  where: `"kind" <> 'before_appointment'`,
})
@Check(
  'CHK_reminder_rules_kind',
  `"kind" IN ('before_appointment', 'maintenance', 'birthday', 'win_back')`,
)
@Check('CHK_reminder_rules_category', `"category" IN ('utility', 'marketing')`)
export class ReminderRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Column({ type: 'varchar', length: 20 })
  kind: ReminderKind;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', nullable: true })
  minutes_before: number | null;

  @Column({ type: 'int', nullable: true })
  days_without_visit: number | null;

  /** `HH:mm` en la zona del negocio. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  send_time: string | null;

  @Column({ type: 'text' })
  template: string;

  @Column({ type: 'varchar', length: 10 })
  category: ReminderCategory;

  /** Plantilla aprobada en Meta; sin ella, la de Agendity para el tipo. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  meta_template_name: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
