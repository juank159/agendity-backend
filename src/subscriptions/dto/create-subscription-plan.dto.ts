// src/subscriptions/dto/create-subscription-plan.dto.ts

import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

export class CreateSubscriptionPlanDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsString()
  @IsOptional()
  currency?: string = 'COP';

  @IsEnum(['month', 'year'])
  billing_interval: string;

  /** Duración del periodo pagado: de aquí sale `subscription_end_date`. */
  @IsInt()
  @Min(1)
  @IsOptional()
  duration_months?: number = 1;

  @IsBoolean()
  @IsOptional()
  is_recurring?: boolean = false; // Nuevo campo

  /** Citas por periodo; -1 = ilimitado. */
  @IsInt()
  @Min(-1)
  appointment_limit: number;

  @IsString()
  @IsOptional()
  wompi_price_id?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean = true;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  features?: string[] = []; // Nuevo campo
}
