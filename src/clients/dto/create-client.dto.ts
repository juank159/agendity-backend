// src/clients/dto/create-client.dto.ts
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

  @IsEmail()
  @IsOptional()
  email?: string;

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
