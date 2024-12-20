import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID, IsEnum, IsString, IsOptional, IsObject } from 'class-validator';
import { ReceiverType, NotificationType } from '../entities/notification.entity';

export class CreateNotificationDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'ID del receptor'
  })
  @IsNotEmpty()
  @IsUUID()
  receiver_id: string;

  @ApiProperty({
    enum: ReceiverType,
    example: ReceiverType.CLIENT,
    description: 'Tipo de receptor'
  })
  @IsNotEmpty()
  @IsEnum(ReceiverType)
  receiver_type: ReceiverType;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.APPOINTMENT_REMINDER,
    description: 'Tipo de notificación'
  })
  @IsNotEmpty()
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({
    example: 'Recordatorio de Cita',
    description: 'Título de la notificación'
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    example: 'Tu cita está programada para mañana a las 15:00',
    description: 'Mensaje de la notificación'
  })
  @IsNotEmpty()
  @IsString()
  message: string;

  @ApiProperty({
    example: { appointmentId: '123', serviceId: '456' },
    description: 'Metadatos adicionales',
    required: false
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}