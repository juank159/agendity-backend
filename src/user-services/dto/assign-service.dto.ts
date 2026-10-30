import { ApiProperty } from '@nestjs/swagger';
import {
  IsUUID,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

/**
 * Servicio asignado a un profesional. Lo validan `POST
 * /users/:userId/services/batch` (con `ParseArrayPipe`, 7.03) y el alta de
 * empleado con servicios (`CreateEmployeeWithDetailsDto`). Mensajes en español.
 */
export class AssignServiceDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del servicio que se asignará al profesional',
    required: true,
  })
  @IsUUID(undefined, { message: 'El servicio no es válido' })
  serviceId: string;

  @ApiProperty({
    example: 75.5,
    description: 'Precio personalizado para este profesional (opcional)',
    required: false,
    minimum: 0,
    type: Number,
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'El precio personalizado debe ser un número' },
  )
  @Min(0, { message: 'El precio personalizado no puede ser negativo' })
  customPrice?: number;

  @ApiProperty({
    example: 30,
    description: 'Comisión del profesional en este servicio (0 a 100 %)',
    required: false,
    minimum: 0,
    maximum: 100,
    type: Number,
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'La comisión debe ser un número' },
  )
  @Min(0, { message: 'La comisión no puede ser menor que 0 %' })
  @Max(100, { message: 'La comisión no puede ser mayor que 100 %' })
  commissionPercentage?: number;

  @ApiProperty({
    example: true,
    description: 'Indica si la asignación del servicio está activa',
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser verdadero o falso' })
  isActive?: boolean;
}
