import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateServiceDto } from './create-service.dto';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateServiceDto extends PartialType(
  // El id no se cambia nunca (10.01b: la app puede darlo solo al crear).
  OmitType(CreateServiceDto, ['id'] as const),
) {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /**
   * Desactivar (o reactivar) el servicio sin borrarlo (2026-10-31). Inactivo:
   * no se agenda, no sale en las horas libres, en `/auth/me/services` ni en la
   * web pública; las citas que ya lo tienen no cambian.
   */
  @IsOptional()
  @IsBoolean({ message: 'isActive debe ser verdadero o falso' })
  isActive?: boolean;
}
