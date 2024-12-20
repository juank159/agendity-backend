import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({
    example: 50.25,
    description: 'Monto a reembolsar'
  })
  @IsNotEmpty()
  @IsNumber()
  refund_amount: number;

  @ApiProperty({
    example: 'Cliente insatisfecho con el servicio',
    description: 'Razón del reembolso'
  })
  @IsNotEmpty()
  @IsString()
  refund_reason: string;
}