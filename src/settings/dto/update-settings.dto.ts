import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsIanaTimeZone } from 'src/common/decorators/is-time-zone.decorator';
import { HHMM } from '../opening-hours';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Franja del horario del negocio (8.01). */
export class OpeningHoursRangeDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Día ISO: 1 = lunes … 7 = domingo',
  })
  @IsInt({ message: 'El día de la semana debe ser un número de 1 a 7' })
  @Min(1, { message: 'El día de la semana debe ser un número de 1 a 7' })
  @Max(7, { message: 'El día de la semana debe ser un número de 1 a 7' })
  day_of_week: number;

  @ApiPropertyOptional({ example: '09:00', description: 'Apertura (HH:mm)' })
  @Matches(HHMM, { message: 'La hora de apertura debe tener el formato HH:mm' })
  start_time: string;

  @ApiPropertyOptional({ example: '18:00', description: 'Cierre (HH:mm)' })
  @Matches(HHMM, { message: 'La hora de cierre debe tener el formato HH:mm' })
  end_time: string;
}

/**
 * `PATCH /settings` (solo Owner). Los campos que no llegan no cambian.
 * 6.01: `timezone`. 8.00: `name`. 8.01: `opening_hours` (`null` = quitar el
 * horario, sin límite; `[]` = cerrado todos los días).
 */
export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'America/Bogota',
    description: 'Zona horaria IANA del negocio',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    example: 'Estudio Cejas & Pestañas',
    description: 'Nombre del negocio (2 a 100 caracteres)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'El nombre del negocio debe ser texto' })
  @Length(2, 100, {
    message: 'El nombre del negocio debe tener entre 2 y 100 caracteres',
  })
  name?: string;

  @ApiPropertyOptional({
    type: [OpeningHoursRangeDto],
    nullable: true,
    description:
      'Horario de apertura por día (null = sin horario; un día sin franjas = cerrado)',
  })
  @IsOptional()
  @IsArray({ message: 'El horario debe ser una lista de franjas' })
  @ArrayMaxSize(28, { message: 'Demasiadas franjas en el horario' })
  @ValidateNested({ each: true })
  @Type(() => OpeningHoursRangeDto)
  opening_hours?: OpeningHoursRangeDto[] | null;
}
