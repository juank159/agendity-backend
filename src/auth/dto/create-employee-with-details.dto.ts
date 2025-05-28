import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateEmployeeDto } from './create-employee.dto';
import { AssignServiceDto } from '../../user-services/dto/assign-service.dto';
import { CreateScheduleDto } from '../../schedules/dto/create-schedule.dto';

export class CreateEmployeeWithDetailsDto extends CreateEmployeeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignServiceDto)
  @IsOptional()
  services?: AssignServiceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateScheduleDto)
  @IsOptional()
  schedules?: CreateScheduleDto[];
}
