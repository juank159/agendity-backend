import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CreateAuthDto } from './create-auth.dto';

export class CreateEmployeeDto extends CreateAuthDto {
  @ApiProperty({
    description: 'IDs de los servicios que puede realizar el empleado',
    example: ['uuid1', 'uuid2'],
    isArray: true,
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  serviceIds?: string[];

  @ApiProperty({
    description: 'Horario del empleado',
    example: {
      monday: { start: '09:00', end: '18:00' },
    },
  })
  @IsObject()
  @IsOptional()
  schedule?: Record<string, { start: string; end: string }>;

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
