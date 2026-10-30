import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { normalizePhone, PUBLIC_PHONE } from '../public-booking-rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `service_ids` en la query: repetido (`?service_ids=a&service_ids=b`) o separado por comas. */
const toIdList = ({ value }: { value: unknown }) =>
  (Array.isArray(value) ? value : [value])
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    .map((v) => v.trim())
    .filter(Boolean);

/** Query de `GET …/professionals`. */
export class PublicProfessionalsQueryDto {
  @ApiProperty({ type: [String], description: 'Servicios elegidos' })
  @Transform(toIdList)
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un servicio' })
  @ArrayMaxSize(10, { message: 'Demasiados servicios' })
  @ArrayUnique({ message: 'No repitas servicios' })
  @IsUUID('all', { each: true, message: 'Servicio no válido' })
  service_ids: string[];
}

/** Query de `GET …/available-slots`. */
export class PublicSlotsQueryDto extends PublicProfessionalsQueryDto {
  @ApiProperty({
    example: '2026-11-02',
    description: 'Día del negocio, YYYY-MM-DD',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha debe tener el formato YYYY-MM-DD',
  })
  date: string;

  @ApiPropertyOptional({
    description: 'Profesional; sin él = cualquiera (unión de horas libres)',
  })
  @IsOptional()
  @IsUUID('all', { message: 'Profesional no válido' })
  professional_id?: string;

  @ApiPropertyOptional({ default: 15, minimum: 5, maximum: 240 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El paso debe ser un número de minutos' })
  @Min(5, { message: 'El paso mínimo es de 5 minutos' })
  @Max(240, { message: 'El paso máximo es de 240 minutos' })
  step?: number;
}

/** Datos del cliente que reserva. */
export class PublicBookingClientDto {
  @ApiProperty({ example: 'Ana' })
  @Transform(trim)
  @IsString({ message: 'El nombre es obligatorio' })
  @Length(2, 50, { message: 'El nombre debe tener entre 2 y 50 caracteres' })
  @Matches(/^[\p{L}\s'.-]+$/u, {
    message: 'El nombre solo puede contener letras',
  })
  name: string;

  @ApiPropertyOptional({ example: 'Pérez' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50, { message: 'El apellido es demasiado largo' })
  @Matches(/^[\p{L}\s'.-]*$/u, {
    message: 'El apellido solo puede contener letras',
  })
  lastname?: string;

  @ApiProperty({ example: '300 123 4567' })
  @Transform(({ value }) => normalizePhone(value))
  @IsString({ message: 'El teléfono es obligatorio' })
  @Matches(PUBLIC_PHONE, {
    message: 'El teléfono debe tener entre 7 y 15 dígitos',
  })
  phone: string;

  @ApiPropertyOptional({ example: 'ana@example.com' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(100, { message: 'El correo es demasiado largo' })
  email?: string;
}

/** `POST …/bookings`: la reserva entra PENDING, sin pago (D-17). */
export class CreatePublicBookingDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un servicio' })
  @ArrayMaxSize(10, { message: 'Demasiados servicios' })
  @ArrayUnique({ message: 'No repitas servicios' })
  @IsUUID('all', { each: true, message: 'Servicio no válido' })
  service_ids: string[];

  @ApiPropertyOptional({ description: 'Sin él (o null) = cualquiera' })
  @IsOptional()
  @IsUUID('all', { message: 'Profesional no válido' })
  professional_id?: string | null;

  @ApiProperty({
    example: '2026-11-02T10:00:00-05:00',
    description: 'Inicio (ISO; sin offset = hora del negocio)',
  })
  @IsNotEmpty({ message: 'Falta la hora de la reserva' })
  @IsISO8601({}, { message: 'La hora de la reserva no es válida' })
  start: string;

  @ApiProperty({ type: PublicBookingClientDto })
  @ValidateNested()
  @Type(() => PublicBookingClientDto)
  client: PublicBookingClientDto;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300, { message: 'La nota es demasiado larga (máx. 300)' })
  notes?: string;

  /**
   * Honeypot: campo oculto en el formulario web. Una persona lo deja vacío;
   * un bot que rellena todo, no → 400.
   */
  @ApiPropertyOptional({ description: 'Debe ir vacío (anti-bots)' })
  @IsOptional()
  @IsString()
  website?: string;
}
