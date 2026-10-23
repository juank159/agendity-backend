import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class RefundPaymentDto {
  @ApiProperty({
    example: 50.25,
    description:
      'Monto a reembolsar (> 0). Los reembolsos se acumulan: el pago pasa a REFUNDED solo cuando se devuelve todo',
  })
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  refund_amount: number;

  @ApiProperty({
    example: 'Cliente insatisfecho con el servicio',
    description: 'Razón del reembolso',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  refund_reason: string;
}
