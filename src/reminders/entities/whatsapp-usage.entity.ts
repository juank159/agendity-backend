import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Consumo de mensajes de WhatsApp de un negocio por mes (`YYYY-MM` en su
 * zona). Se suma con un UPDATE condicional: nunca pasa del cupo del plan.
 */
@Entity('whatsapp_usage')
export class WhatsappUsage {
  @PrimaryColumn({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @PrimaryColumn({ type: 'varchar', length: 7 })
  period: string;

  @Column({ type: 'int', default: 0 })
  used: number;

  /** Aviso de "cupo agotado" al Owner (uno por mes). */
  @Column({
    name: 'exhausted_notified_at',
    type: 'timestamptz',
    nullable: true,
  })
  exhaustedNotifiedAt: Date | null;
}
