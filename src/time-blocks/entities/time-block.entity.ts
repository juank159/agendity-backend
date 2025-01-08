import { BadRequestException } from '@nestjs/common';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ERROR_MESSAGES } from '../constants/time-block.constants';

@Entity()
export class TimeBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamp' })
  start_datetime: Date;

  @Column({ type: 'timestamp' })
  end_datetime: Date;

  @Column({ nullable: true })
  notes?: string;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => Appointment, { nullable: true })
  appointment?: Appointment;

  static validateDateRange(start: Date, end: Date): void {
    if (start >= end) {
      throw new BadRequestException(ERROR_MESSAGES.INVALID_DATE_RANGE);
    }
  }

  update(props: Partial<TimeBlock>): void {
    if (props.start_datetime && props.end_datetime) {
      TimeBlock.validateDateRange(props.start_datetime, props.end_datetime);
    }
    Object.assign(this, props);
  }
}
