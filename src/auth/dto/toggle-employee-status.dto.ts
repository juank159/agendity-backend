import { RawBoolean } from 'src/common/decorators/raw-boolean.decorator';
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleEmployeeStatusDto {
  @ApiProperty({
    description: 'Estado activo/inactivo del empleado',
    example: true,
  })
  @RawBoolean()
  @IsBoolean()
  isActive: boolean;
}
