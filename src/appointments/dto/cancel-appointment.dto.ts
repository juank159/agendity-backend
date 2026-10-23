import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @ApiProperty({
    example: 'El cliente no puede asistir',
    description: 'Motivo de la cancelación (opcional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellation_reason?: string;
}
