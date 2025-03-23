// src/subscriptions/dto/wompi-webhook.dto.ts

import {
  IsString,
  IsObject,
  IsArray,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';

export class WompiWebhookDto {
  @IsString()
  @IsNotEmpty()
  event: string;

  @IsObject()
  data: {
    transaction?: {
      id: string;
      status: string;
      amount_in_cents: number;
      currency: string;
      reference: string;
      payment_method?: {
        type: string;
        extra?: {
          receipt_url?: string;
        };
      };
    };
    subscription?: {
      id: string;
      status: string;
    };
  };

  @IsObject()
  @IsOptional()
  environment?: string;

  @IsString()
  @IsOptional()
  signature?: string;
}
