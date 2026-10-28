import { BadRequestException } from '@nestjs/common';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ERROR_MESSAGES } from '../constants/time-block.constants';

@Entity()
export class TimeBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamptz' })
  start_datetime: Date;

  @Column({ type: 'timestamptz' })
  end_datetime: Date;

  /**
   * Zona IANA del negocio con la que se creó (o movió) el bloqueo (6.03, D-15): si el negocio
   * cambia de zona después, este registro conserva la suya. La fija el
   * service desde `TenantSettingsService.getTimezone`; sale en las respuestas.
   */
  @Column({ type: 'varchar', length: 64, name: 'timezone' })
  timezone: string;

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
