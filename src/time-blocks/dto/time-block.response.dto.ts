import { Appointment } from 'src/appointments/entities/appointment.entity';
import { User } from 'src/users/entities/user.entity';
import { TimeBlock } from '../entities/time-block.entity';

export class TimeBlockResponseDto {
  id: string;
  start_datetime: Date;
  end_datetime: Date;
  /** Zona IANA del bloqueo (6.03). */
  timezone: string;
  notes?: string;
  user: User;
  appointment?: Appointment;

  static fromEntity(timeBlock: TimeBlock): TimeBlockResponseDto {
    const response = new TimeBlockResponseDto();
    Object.assign(response, timeBlock);
    return response;
  }
}
