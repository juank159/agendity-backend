// src/payments/dto/update-custom-payment-method.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomPaymentMethodDto } from './create-custom-payment-method.dto';

export class UpdateCustomPaymentMethodDto extends PartialType(
  CreateCustomPaymentMethodDto,
) {}
