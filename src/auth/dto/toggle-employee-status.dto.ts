import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleEmployeeStatusDto {
  @ApiProperty({
    description: 'Estado activo/inactivo del empleado',
    example: true,
  })
  @IsBoolean()
  isActive: boolean;
}
