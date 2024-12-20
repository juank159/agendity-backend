import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Appointment } from '../../appointments/entities/appointment.entity';

@Entity('time_blocks')
export class TimeBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.timeBlocks)
  user: User;

  @OneToOne(() => Appointment)
  @JoinColumn()
  appointment: Appointment;

  @Column('timestamptz')
  start_datetime: Date;

  @Column('timestamptz')
  end_datetime: Date;

  @Column('text', { nullable: true })
  notes?: string;

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