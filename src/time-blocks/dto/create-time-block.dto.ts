import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsDateString, IsString, IsOptional } from 'class-validator';

export class CreateTimeBlockDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del profesional'
  })
  @IsNotEmpty()
  @IsUUID()
  user_id: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID de la cita asociada',
    required: false
  })
  @IsOptional()
  @IsUUID()
  appointment_id?: string;

  @ApiProperty({
    example: '2024-12-25T14:00:00.000Z',
    description: 'Fecha y hora de inicio'
  })
  @IsNotEmpty()
  @IsDateString()
  start_datetime: Date;

  @ApiProperty({
    example: '2024-12-25T15:00:00.000Z',
    description: 'Fecha y hora de fin'
  })
  @IsNotEmpty()
  @IsDateString()
  end_datetime: Date;

  @ApiProperty({
    example: 'Bloque reservado para mantenimiento',
    description: 'Notas adicionales',
    required: false
  })
  @IsOptional()
  @IsString()
  notes?: string;
}