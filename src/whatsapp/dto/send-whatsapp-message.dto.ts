import { IsString, IsNotEmpty } from 'class-validator';

export class SendWhatsappMessageDto {
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
