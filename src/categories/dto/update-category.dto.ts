import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateCategoryDto } from './create-category.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCategoryDto extends PartialType(
  // El id no se cambia nunca (10.01b: la app puede darlo solo al crear).
  OmitType(CreateCategoryDto, ['id'] as const),
) {
  @ApiProperty({
    description: 'Estado de activación de la categoría',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
