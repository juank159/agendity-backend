import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CreateAuthDto } from './create-auth.dto';
import { IsWeekSchedule } from 'src/schedules/dto/is-week-schedule.decorator';
import { WeekScheduleInput } from 'src/schedules/week-schedule';

export class CreateEmployeeDto extends CreateAuthDto {
  @ApiProperty({
    description: 'IDs de los servicios que puede realizar el empleado',
    example: ['uuid1', 'uuid2'],
    isArray: true,
  })
  @IsArray()
  // Cualquier versión (7.05a): los ids creados sin conexión son UUID v7.
  @IsUUID('all', { each: true })
  @IsOptional()
  serviceIds?: string[];

  /**
   * Horario por día (13.04): lista de franjas `HH:mm` (varias por día, sin
   * solaparse) o, en el formato anterior, una sola `{ start, end }`. Un día
   * que no viene queda sin franjas. Ver `schedules/week-schedule.ts`.
   */
  @ApiProperty({
    description:
      'Horario por día: lista de franjas {start, end} en HH:mm (o una sola franja, formato anterior)',
    example: {
      monday: [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
      tuesday: { start: '09:00', end: '18:00' },
    },
    required: false,
  })
  @IsOptional()
  @IsWeekSchedule()
  schedule?: WeekScheduleInput;

  /**
   * Comisión general del empleado (8.02, D-16): % de cada servicio que
   * atiende, salvo excepción por servicio. 0 a 100; si no llega, 0.
   */
  @ApiProperty({
    description: 'Comisión general del empleado (0 a 100 %)',
    example: 30,
    required: false,
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'La comisión debe ser un número' },
  )
  @Min(0, { message: 'La comisión no puede ser menor que 0 %' })
  @Max(100, { message: 'La comisión no puede ser mayor que 100 %' })
  commission_percentage?: number;
}
