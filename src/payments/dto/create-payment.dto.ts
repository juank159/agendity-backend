// import { ApiProperty } from '@nestjs/swagger';
// import {
//   IsNotEmpty,
//   IsUUID,
//   IsEnum,
//   IsNumber,
//   IsOptional,
//   IsString,
//   IsObject,
// } from 'class-validator';
// import { PaymentMethod } from 'src/common/enums/status.enum';

// export class CreatePaymentDto {
//   @ApiProperty({
//     example: '123e4567-e89b-12d3-a456-426614174000',
//     description: 'ID de la cita',
//   })
//   @IsNotEmpty()
//   @IsUUID()
//   appointment_id: string;

//   @ApiProperty({
//     example: 100.5,
//     description: 'Monto del pago',
//   })
//   @IsNotEmpty()
//   @IsNumber()
//   amount: number;

//   @ApiProperty({
//     enum: PaymentMethod,
//     example: PaymentMethod.CREDIT_CARD,
//     description: 'Método de pago',
//   })
//   @IsNotEmpty()
//   @IsEnum(PaymentMethod)
//   payment_method: PaymentMethod;

//   @ApiProperty({
//     example: 'TRX123456',
//     description: 'ID de transacción del procesador de pago',
//     required: false,
//   })
//   @IsOptional()
//   @IsString()
//   transaction_id?: string;

//   @ApiProperty({
//     example: { cardLast4: '4242', brand: 'visa' },
//     description: 'Detalles adicionales del pago',
//     required: false,
//   })
//   @IsOptional()
//   @IsObject()
//   payment_details?: Record<string, any>;
// }

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
  ValidateIf,
} from 'class-validator';
import { PaymentMethod } from 'src/common/enums/status.enum';

export class CreatePaymentDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID de la cita',
  })
  @IsNotEmpty()
  @IsUUID()
  appointment_id: string;

  @ApiProperty({
    example: 100.5,
    description: 'Monto del pago',
  })
  @IsNotEmpty()
  @IsNumber()
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
