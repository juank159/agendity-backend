// import {
//   IsNotEmpty,
//   IsNumber,
//   IsOptional,
//   IsString,
//   IsUUID,
//   Matches,
//   MaxLength,
//   Min,
// } from 'class-validator';
// import { ApiProperty } from '@nestjs/swagger';

// export class CreateServiceDto {
//   @ApiProperty({
//     description: 'Nombre del servicio',
//     example: 'pestañas pelo a pelo',
//     required: true,
//     maxLength: 100,
//   })
//   @IsNotEmpty()
//   @IsString()
//   @MaxLength(100)
//   name: string;

//   @ApiProperty({
//     description: 'Descripción detallada del servicio',
//     example: 'Pestañas pelo a pelo tecnica 3D',
//     required: false,
//     nullable: true,
//   })
//   @IsOptional()
//   @IsString()
//   description?: string;

//   @ApiProperty({
//     description: 'Precio del servicio',
//     example: 35.99,
//     minimum: 0,
//     required: true,
//   })
//   @IsNotEmpty()
//   @IsNumber()
//   @Min(0)
//   price: number;

//   @ApiProperty({
//     description: 'Duración del servicio en minutos',
//     example: 60,
//     minimum: 1,
//     required: true,
//   })
//   @IsNotEmpty()
//   @IsNumber()
//   @Min(1)
//   duration: number;

//   @ApiProperty({
//     description: 'ID de la categoría a la que pertenece el servicio',
//     example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
//     required: true,
//     format: 'uuid',
//   })
//   @IsNotEmpty()
//   @IsUUID()
//   categoryId: string;

//   @ApiProperty({
//     description: 'Descripción detallada del servicio',
//     example: 'Pestañas pelo a pelo tecnica 3D',
//     required: false,
//     nullable: true,
//   })
//   @IsOptional()
//   @IsString()
//   @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) // Validar que sea un color hexadecimal
//   color?: string;
// }

import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateServiceDto {
  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'Pestañas pelo a pelo',
    required: true,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Descripción detallada del servicio',
    example: 'Pestañas pelo a pelo técnica 3D',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Precio del servicio',
    example: 35.99,
    minimum: 0,
    required: true,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Duración del servicio en minutos',
    example: 60,
    minimum: 1,
    required: true,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  duration: number;

  @ApiProperty({
    description: 'ID de la categoría a la que pertenece el servicio',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
    required: true,
    format: 'uuid',
  })
  @IsNotEmpty()
  @IsUUID()
  categoryId: string;

  @ApiProperty({
    description: 'Color representativo del servicio (en formato hexadecimal)',
    example: '#FF5733',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/) // Validar que sea un color hexadecimal
  color?: string;

  @ApiProperty({
    description: 'Tipo de precio del servicio (Precio fijo o Precio variable)',
    example: 'Precio fijo',
    enum: ['Precio fijo', 'Precio variable'],
    required: false,
    default: 'Precio fijo',
  })
  @IsOptional()
  @IsEnum(['Precio fijo', 'Precio variable'], {
    message: 'priceType debe ser "Precio fijo" o "Precio variable"',
  })
  priceType: 'Precio fijo' | 'Precio variable' = 'Precio fijo';

  @ApiProperty({
    description: 'Habilitar reserva en línea',
    example: true,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  onlineBooking: boolean = true;

  @ApiProperty({
    description: 'URL de la imagen representativa del servicio',
    example: 'https://example.com/image.jpg',
    required: false,
  })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiProperty({
    description: 'Abono requerido para el servicio',
    example: 20,
    required: false,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deposit: number = 0;
}
