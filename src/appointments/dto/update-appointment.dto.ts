import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateAppointmentDto } from './create-appointment.dto';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AppointmentStatus } from 'src/common/enums/status.enum';

/**
 * PATCH genérico de una cita (Owner). `status` pasa por la máquina de estados
 * (`appointment-status.ts`); una transición inválida → 409
 * INVALID_STATE_TRANSITION. `payment_status` ya no se acepta (2.06): sale de
 * los pagos (`POST /payments` y el reembolso), nunca a mano.
 */
export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiProperty({ enum: AppointmentStatus, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({
    required: false,
    description: 'Solo se guarda si la petición cancela la cita',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellation_reason?: string;
}
