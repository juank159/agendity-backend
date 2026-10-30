import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  /**
   * Id generado por la app (UUID, 10.01b, D-18). Opcional: si no llega, lo
   * genera el servidor. Si ya existe → 409 `CONFLICT`.
   */
  @IsOptional()
  @IsUUID('all', { message: 'El id debe ser un UUID' })
  id?: string;

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
}
