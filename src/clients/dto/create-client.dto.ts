// src/clients/dto/create-client.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateClientDto {
  @ApiProperty({
    example: 'Juan',
    description: 'Nombre del cliente'
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Pérez',
    description: 'Apellido del cliente'
  })
  @IsNotEmpty()
  @IsString()
  lastname: string;

  @ApiProperty({
    example: 'juan.perez@example.com',
    description: 'Correo electrónico del cliente'
  })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    example: '+573101234567',
    description: 'Número de teléfono del cliente'
  })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({
    example: 'https://example.com/image.jpg',
    description: 'URL de la imagen del cliente',
    required: false
  })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiProperty({
    example: 'Calle 123 #45-67',
    description: 'Dirección del cliente',
    required: false
  })
  @IsOptional()
  @IsString()
  address?: string;
}