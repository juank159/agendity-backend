import { PartialType } from '@nestjs/swagger';
import { CreateNotificationDto } from './create-notification.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {
  @ApiProperty({
    example: true,
    description: 'Estado de lectura de la notificación'
  })
  @IsOptional()
  @IsBoolean()
  read?: boolean;
}