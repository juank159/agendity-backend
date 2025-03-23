// src/subscriptions/dto/subscription-status.dto.ts

import { IsBoolean, IsString, IsOptional } from 'class-validator';

export class SubscriptionStatusDto {
  @IsBoolean()
  canCreateAppointment: boolean;

  @IsString()
  @IsOptional()
  message?: string;
}
