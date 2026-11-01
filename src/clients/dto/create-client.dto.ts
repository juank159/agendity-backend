// src/clients/dto/create-client.dto.ts
import { RawBoolean } from 'src/common/decorators/raw-boolean.decorator';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsOptional,
  Matches,
  IsBoolean,
  IsISO8601,
  IsUUID,
} from 'class-validator';

export class CreateClientDto {
  /**
   * Id generado por la app (UUID, 10.01b, D-18). Opcional: si no llega, lo
   * genera el servidor. Si ya existe → 409 `CONFLICT`.
   */
  @IsOptional()
  @IsUUID('all', { message: 'El id debe ser un UUID' })
  id?: string;

  @IsString()
  name: string;

  @IsString()
  lastname: string;

  // Opcional (2.20). La app envía '' cuando el cliente no tiene email: '' (o
  // solo espacios) se guarda como null en vez de fallar la validación.
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  @IsEmail()
  @IsOptional()
  email?: string | null;

  @IsString()
  @Matches(/^\+?[\d\s-]+$/, {
    message:
      'El teléfono solo puede contener números, espacios, guiones y el símbolo +',
  })
  phone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsString()
  @IsOptional()
  deviceContactId?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  @IsISO8601()
  birthday?: string;

  @IsOptional()
  @RawBoolean()
  @IsBoolean()
  showNotes?: boolean;

  /**
   * Consentimiento para WhatsApp automáticos (Fase 11, Ley 1581). `true` lo
   * registra con fecha; `false` es la baja (fecha en `whatsapp_opt_out_at`).
   */
  @IsOptional()
  @RawBoolean()
  @IsBoolean({ message: 'whatsapp_opt_in debe ser verdadero o falso' })
  whatsapp_opt_in?: boolean;
}
