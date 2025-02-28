import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateWhatsappConfigDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}
