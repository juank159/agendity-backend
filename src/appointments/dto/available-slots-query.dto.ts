import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SLOT_STEP_MINUTES } from '../appointment-slot';

/** `?service_ids=a&service_ids=b` (array) o `?service_ids=a,b` (cadena) → array. */
function toIdList({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(','));
  if (typeof value === 'string') return value.split(',').filter(Boolean);
  return value;
}

/** Query de `GET /appointments/available-slots` (2.14). */
export class AvailableSlotsQueryDto {
  @ApiProperty({ description: 'ID del profesional', format: 'uuid' })
  @IsNotEmpty()
  @IsUUID()
  professional_id: string;

  @ApiProperty({
    example: '2026-10-26',
    description:
      'Día en la zona del negocio (la configurada en /settings), YYYY-MM-DD',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener el formato YYYY-MM-DD',
  })
  date: string;

  @ApiProperty({
    type: [String],
    description:
      'Servicios de la cita (como al agendar: al menos uno, sin repetidos). Repetido o separado por comas',
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayMinSize(1, { message: 'Indica al menos un servicio' })
  @ArrayUnique({ message: 'No repitas servicios' })
  @IsUUID('4', { each: true })
  service_ids: string[];

  @ApiPropertyOptional({
    default: SLOT_STEP_MINUTES.default,
    minimum: SLOT_STEP_MINUTES.min,
    maximum: SLOT_STEP_MINUTES.max,
    description: 'Separación en minutos entre inicios candidatos',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SLOT_STEP_MINUTES.min)
  @Max(SLOT_STEP_MINUTES.max)
  step?: number;
}
