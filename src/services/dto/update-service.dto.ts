import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateServiceDto } from './create-service.dto';
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateServiceDto extends PartialType(
  // El id no se cambia nunca (10.01b: la app puede darlo solo al crear).
  OmitType(CreateServiceDto, ['id'] as const),
) {
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
