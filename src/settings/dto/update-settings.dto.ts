import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsIanaTimeZone } from 'src/common/decorators/is-time-zone.decorator';

/** `PATCH /settings` (solo Owner, 6.01). Los campos que no llegan no cambian. */
export class UpdateSettingsDto {
  @ApiPropertyOptional({
    example: 'America/Bogota',
    description: 'Zona horaria IANA del negocio',
  })
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;
}
