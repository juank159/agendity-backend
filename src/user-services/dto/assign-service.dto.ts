import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNumber, IsOptional, IsBoolean } from 'class-validator';

export class AssignServiceDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del servicio que se asignará al profesional',
    required: true
  })
  @IsUUID()
  serviceId: string;

  @ApiProperty({
    example: 75.50,
    description: 'Precio personalizado para este profesional (opcional)',
    required: false,
    minimum: 0,
    type: Number
  })
  @IsOptional()
  @IsNumber()
  customPrice?: number;

  @ApiProperty({
    example: true,
    description: 'Indica si la asignación del servicio está activa',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}