// src/subscriptions/dto/create-payment-link.dto.ts

import { IsString, IsUUID, IsUrl, IsOptional } from 'class-validator';

export class CreatePaymentLinkDto {
  @IsUUID()
  tenant_id: string;

  @IsUUID()
  plan_id: string;

  @IsUrl()
  redirect_url: string;

  @IsString()
  @IsOptional()
  description?: string;
}
