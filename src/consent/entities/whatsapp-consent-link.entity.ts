import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Client } from '../../clients/entities/client.entity';

/**
 * Link de consentimiento de WhatsApp (11.06): uno por `POST
 * /clients/:id/consent-link`. Lo hace de un solo uso y guarda la PRUEBA del
 * consentimiento (Ley 1581): cuándo, desde qué IP y con qué navegador lo
 * aceptó el cliente. Se borra con el cliente.
 */
@Entity('whatsapp_consent_links')
@Index('IDX_whatsapp_consent_links_client', ['clientId'])
export class WhatsappConsentLink {
  /** `j` del token. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner?: User;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client?: Client;

  /** Quién generó el link (Owner o Employee). */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator?: User | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'accepted_ip', type: 'varchar', length: 64, nullable: true })
  acceptedIp: string | null;

  @Column({
    name: 'accepted_user_agent',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  acceptedUserAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
