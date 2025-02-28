// src/whatsapp/entities/whatsapp-config.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('whatsapp_configurations')
export class WhatsappConfiguration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column('text', { name: 'phone_number' })
  phoneNumber: string;

  @Column('text', { name: 'api_key' })
  apiKey: string;

  @Column('boolean', { name: 'is_enabled', default: true })
  isEnabled: boolean;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    name: 'updated_at',
  })
  updatedAt: Date;
}
