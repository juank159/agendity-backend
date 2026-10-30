import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import { CreateAuthDto } from './create-auth.dto';

/**
 * `POST /auth/register/owner` (6.01): los datos del Owner más la zona horaria
 * de su negocio y, desde 8.00, su nombre. Va aparte de `CreateAuthDto` para que las rutas de empleados
 * (que heredan de él) no acepten una zona que ignorarían.
 */
export class RegisterOwnerDto extends CreateAuthDto {
  /**
   * Zona IANA del negocio: la app envía la del dispositivo. Si no llega o no es
   * válida, el alta usa `BUSINESS_TIMEZONE` (no falla por esto).
   */
  @ApiProperty({
    example: 'America/Bogota',
    description:
      'Zona horaria IANA del negocio (la del dispositivo). Opcional: si falta o no es válida se usa la zona por defecto',
    required: false,
  })
  @IsOptional()
  timezone?: string;

  /**
   * Nombre del negocio (8.00), texto libre ("Estudio Cejas & Pestañas").
   * Opcional para no romper la app actual; se puede poner después por
   * `PATCH /settings`.
   */
  @ApiProperty({
    example: 'Estudio Cejas & Pestañas',
    description: 'Nombre del negocio (2 a 100 caracteres). Opcional',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El nombre del negocio debe ser texto' })
  @Length(2, 100, {
    message: 'El nombre del negocio debe tener entre 2 y 100 caracteres',
  })
  business_name?: string;
}
