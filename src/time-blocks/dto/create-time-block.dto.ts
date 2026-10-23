import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsDateString,
  IsString,
  IsOptional,
} from 'class-validator';

/**
 * Fechas como `string` ISO 8601 (con o sin offset; sin offset = hora del
 * negocio, `parseBusinessDate`). No declararlas `Date`: con
 * `enableImplicitConversion` llegaban convertidas y `@IsDateString` rechazaba
 * toda petición (2.08).
 */
export class CreateTimeBlockDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del profesional',
  })
  @IsNotEmpty()
  @IsUUID()
  user_id: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID de la cita asociada',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  appointment_id?: string;

  @ApiProperty({
    example: '2024-12-25T14:00:00.000Z',
    description: 'Fecha y hora de inicio',
  })
  @IsNotEmpty()
  @IsDateString()
  start_datetime: string;

  @ApiProperty({
    example: '2024-12-25T15:00:00.000Z',
    description: 'Fecha y hora de fin',
  })
  @IsNotEmpty()
  @IsDateString()
  end_datetime: string;

  @ApiProperty({
    example: 'Bloque reservado para mantenimiento',
    description: 'Notas adicionales',
    required: false,
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
