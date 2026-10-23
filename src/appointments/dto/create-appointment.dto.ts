import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsString,
  IsArray,
  ArrayMinSize,
  ArrayUnique,
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
    description:
      'Servicios de la cita: al menos uno y sin repetidos (2.08: antes una lista vacía creaba una cita de 0 min)',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'La cita debe tener al menos un servicio' })
  @ArrayUnique({ message: 'La cita no puede repetir un servicio' })
  @IsUUID('4', { each: true })
  service_ids: string[];

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description:
      'Obsoleto e ignorado: el negocio sale del JWT (ARQUITECTURA §3). Se acepta por compatibilidad con la app.',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  owner_id?: string;

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
