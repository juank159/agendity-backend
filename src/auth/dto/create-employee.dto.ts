import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsUUID } from 'class-validator';
import { CreateAuthDto } from './create-auth.dto';

export class CreateEmployeeDto extends CreateAuthDto {
  @ApiProperty({
    description: 'IDs de los servicios que puede realizar el empleado',
    example: ['uuid1', 'uuid2'],
    isArray: true,
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  serviceIds?: string[];

  @ApiProperty({
    description: 'Horario del empleado',
    example: {
      monday: { start: '09:00', end: '18:00' },
    },
  })
  @IsObject()
  @IsOptional()
  schedule?: Record<string, { start: string; end: string }>;
}
