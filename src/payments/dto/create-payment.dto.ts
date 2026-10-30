// src/payments/dto/create-payment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsObject,
  IsPositive,
  ValidateIf,
} from 'class-validator';
import { PaymentMethod } from 'src/common/enums/status.enum';

export class CreatePaymentDto {
  /**
   * Id generado por la app (UUID, 10.01b, D-18). Opcional: si no llega, lo
   * genera el servidor. Si ya existe → 409 `CONFLICT`.
   */
  @IsOptional()
  @IsUUID('all', { message: 'El id debe ser un UUID' })
  id?: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID de la cita',
  })
  @IsNotEmpty()
  @IsUUID()
  appointment_id: string;

  @ApiProperty({
    example: 100.5,
    description:
      'Monto del pago: > 0 y sin superar el total de la cita (`total_price`)',
  })
  @IsNotEmpty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiProperty({
    enum: PaymentMethod,
    example: PaymentMethod.CREDIT_CARD,
    description: 'Método de pago estándar',
    required: false,
  })
  @ValidateIf((o) => !o.custom_payment_method_id)
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del método de pago personalizado',
    required: false,
  })
  @ValidateIf((o) => !o.payment_method)
  @IsUUID()
  custom_payment_method_id?: string;

  @ApiProperty({
    example: 'TRX123456',
    description: 'ID de transacción del procesador de pago',
    required: false,
  })
  @IsOptional()
  @IsString()
  transaction_id?: string;

  @ApiProperty({
    example: { cardLast4: '4242', brand: 'visa' },
    description: 'Detalles adicionales del pago',
    required: false,
  })
  @IsOptional()
  @IsObject()
  payment_details?: Record<string, any>;
}
