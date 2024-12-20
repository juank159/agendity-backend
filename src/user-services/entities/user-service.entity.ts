import { Entity, Column, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Service } from 'src/services/entities/service.entity';

@Entity('user_services')
export class UserService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  customPrice: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @ManyToOne(() => User, user => user.userServices)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Service, service => service.userServices)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}