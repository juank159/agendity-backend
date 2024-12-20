import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
} from 'class-validator';
import {
  AppointmentStatus,
  PaymentStatus,
} from '../entities/appointment.entity';

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
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del servicio',
  })
  @IsNotEmpty()
  @IsUUID()
  service_id: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del dueño del negocio',
  })
  @IsNotEmpty()
  @IsUUID()
  owner_id: string;

  @ApiProperty({
    example: '2024-12-25T14:30:00.000Z',
    description: 'Fecha y hora de la cita',
  })
  @IsNotEmpty()
  @IsDateString()
  date: Date;

  @ApiProperty({
    example: 100.0,
    description: 'Precio total de la cita',
  })
  @IsNotEmpty()
  @IsNumber()
  total_price: number;

  @ApiProperty({
    example: 'Cliente solicita música relajante',
    description: 'Notas adicionales',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
