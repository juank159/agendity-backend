import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  ArrayMinSize,
  IsISO8601,
} from 'class-validator';

export class CreateAppointmentDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del cliente',
  })
  @IsNotEmpty()
  @IsUUID()
  client_id: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del profesional',
  })
  @IsNotEmpty()
  @IsUUID()
  professional_id: string;

  @ApiProperty({
    example: ['123e4567-e89b-12d3-a456-426614174000'],
    description: 'ID del servicio',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  service_ids: string[];

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del dueño del negocio',
  })
  @IsNotEmpty()
  @IsUUID()
  owner_id: string;

  @IsNotEmpty()
  @IsISO8601()
  @ApiProperty({
    example: '2025-02-17T15:30:00',
    description: 'Fecha y hora de la cita en hora local',
  })
  date: string;

  @ApiProperty({
    example: 'Cliente solicita música relajante',
    description: 'Notas adicionales',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
