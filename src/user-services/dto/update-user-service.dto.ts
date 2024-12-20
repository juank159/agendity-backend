import { PartialType } from '@nestjs/mapped-types';
import { AssignServiceDto } from './assign-service.dto';


export class UpdateUserServiceDto extends PartialType(AssignServiceDto) {}
