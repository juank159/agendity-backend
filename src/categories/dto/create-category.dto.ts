import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Nombre de la categoría',
    example: 'Cejas',
    required: true,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Descripción detallada de la categoría',
    example: 'Servicio de Cejas',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'ID único del dueño del negocio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}
