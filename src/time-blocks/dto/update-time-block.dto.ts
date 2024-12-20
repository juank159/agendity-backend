import { PartialType } from '@nestjs/swagger';
import { CreateTimeBlockDto } from './create-time-block.dto';

export class UpdateTimeBlockDto extends PartialType(CreateTimeBlockDto) {}
