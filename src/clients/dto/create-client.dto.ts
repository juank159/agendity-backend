// src/clients/dto/create-client.dto.ts
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  IsOptional,
  Matches,
  IsBoolean,
  IsISO8601,
} from 'class-validator';

export class CreateClientDto {
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
  @IsBoolean()
  showNotes?: boolean;
}
