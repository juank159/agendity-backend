import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePaymentDto } from './create-payment.dto';

export class UpdatePaymentDto extends PartialType(
  // El id no se cambia nunca (10.01b: la app puede darlo solo al crear).
  OmitType(CreatePaymentDto, ['id'] as const),
) {}
