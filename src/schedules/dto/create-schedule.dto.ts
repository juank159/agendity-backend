import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsInt, IsString, IsBoolean, Min, Max, Matches } from 'class-validator';

export class CreateScheduleDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del profesional'
  })
  @IsNotEmpty()
  @IsUUID()
  user_id: string;

  @ApiProperty({
    example: 1,
    description: 'Día de la semana (1-7, donde 1 es Lunes)',
    minimum: 1,
    maximum: 7
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(7)
  day_of_week: number;

  @ApiProperty({
    example: '09:00',
    description: 'Hora de inicio (formato HH:mm)'
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'El formato de hora debe ser HH:mm'
  })
  start_time: string;

  @ApiProperty({
    example: '17:00',
    description: 'Hora de fin (formato HH:mm)'
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'El formato de hora debe ser HH:mm'
  })
  end_time: string;

  @ApiProperty({
    example: true,
    description: 'Indica si el horario está disponible'
  })
  @IsBoolean()
  is_available: boolean;
}