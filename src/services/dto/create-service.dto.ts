import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'pestañas pelo a pelo',
    required: true,
    maxLength: 100
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Descripción detallada del servicio',
    example: 'Pestañas pelo a pelo tecnica 3D',
    required: false,
    nullable: true
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Precio del servicio',
    example: 35.99,
    minimum: 0,
    required: true
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Duración del servicio en minutos',
    example: 60,
    minimum: 1,
    required: true
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  duration: number;

  @ApiProperty({
    description: 'ID de la categoría a la que pertenece el servicio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    required: true,
    format: 'uuid'
  })
  @IsNotEmpty()
  @IsUUID()
  categoryId: string;
}