import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTimeBlockDto } from './create-time-block.dto';

export class UpdateTimeBlockDto extends PartialType(
  // El id no se cambia nunca (10.01b: la app puede darlo solo al crear).
  OmitType(CreateTimeBlockDto, ['id'] as const),
) {}
