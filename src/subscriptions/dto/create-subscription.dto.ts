// src/subscriptions/dto/create-subscription.dto.ts

import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  tenant_id: string;

  @IsUUID()
  plan_id: string;

  @IsString()
  card_token_id: string;

  @IsEnum(['trial', 'active', 'past_due', 'canceled', 'expired'])
  @IsOptional()
  status?: string = 'trial';
}
