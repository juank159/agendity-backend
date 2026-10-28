import { ApiProperty } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { CreateAuthDto } from './create-auth.dto';

/**
 * `POST /auth/register/owner` (6.01): los datos del Owner más la zona horaria
 * de su negocio. Va aparte de `CreateAuthDto` para que las rutas de empleados
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
}
