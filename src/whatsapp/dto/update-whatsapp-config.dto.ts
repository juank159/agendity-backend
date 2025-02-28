import { PartialType } from '@nestjs/mapped-types';
import { CreateWhatsappConfigDto } from './create-whatsapp-config.dto';

export class UpdateWhatsappConfigDto extends PartialType(
  CreateWhatsappConfigDto,
) {}
