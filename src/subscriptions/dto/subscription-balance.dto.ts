// src/subscriptions/dto/subscription-balance.dto.ts

import { IsNumber, IsString, IsDate, IsOptional } from 'class-validator';

export class SubscriptionBalanceDto {
  @IsString()
  status: string;

  @IsNumber()
  appointments_used: number;

  @IsNumber()
  appointments_limit: number;

  @IsNumber()
  appointments_remaining: number;

  @IsDate()
  @IsOptional()
  next_billing_date?: Date;

  @IsString()
  @IsOptional()
  plan_name?: string;
}
