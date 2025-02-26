// src/payments/dto/create-custom-payment-method.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateCustomPaymentMethodDto {
  @ApiProperty({
    example: 'Nequi',
    description: 'Nombre del método de pago personalizado',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Pago a través de Nequi al número 300-123-4567',
    description: 'Descripción del método de pago',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: 'nequi-icon.png',
    description: 'Ícono o imagen representativa',
    required: false,
  })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({
    example: true,
    description: 'Indica si el método de pago está activo',
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
