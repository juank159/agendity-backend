// src/subscriptions/dto/create-subscription.dto.ts

import { IsString, IsUUID, IsOptional, IsEnum, Matches } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  tenant_id: string;

  @IsUUID()
  plan_id: string;

  @IsString()
  @IsOptional() // Lo hacemos opcional para que funcione con links de pago
  card_token_id?: string;

  @IsEnum(['trial', 'active', 'past_due', 'canceled', 'expired'])
  @IsOptional()
  status?: string = 'trial';

  @IsString()
  @Matches(/^(https?:\/\/|myapp:\/\/).*/, {
    message:
      'redirect_url must be a URL address (http://, https://, or myapp://)',
  })
  @IsOptional()
  redirect_url?: string; // URL de redirección después del pago
}
