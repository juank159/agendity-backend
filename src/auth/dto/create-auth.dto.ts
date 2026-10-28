import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Matches,
  Length,
} from 'class-validator';

export class CreateAuthDto {
  @ApiProperty({
    example: 'Juan',
    description: 'Nombre del usuario',
    required: true,
  })
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @Length(2, 50, { message: 'El nombre debe tener entre 2 y 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, {
    message: 'El nombre solo puede contener letras y espacios',
  })
  name: string;

  @ApiProperty({
    example: 'Pérez García',
    description: 'Apellido del usuario',
    required: true,
  })
  @IsNotEmpty({ message: 'El apellido es obligatorio' })
  @IsString({ message: 'El apellido debe ser una cadena de texto' })
  @Length(2, 50, { message: 'El apellido debe tener entre 2 y 50 caracteres' })
  @Matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, {
    message: 'El apellido solo puede contener letras y espacios',
  })
  lastname: string;

  @ApiProperty({
    example: 'juan.perez@example.com',
    description: 'Correo electrónico del usuario',
    required: true,
    uniqueItems: true,
  })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  @IsString({ message: 'El correo debe ser una cadena de texto' })
  @IsEmail({}, { message: 'Debe ser un correo electrónico válido' })
  @Length(5, 100, { message: 'El correo debe tener entre 5 y 100 caracteres' })
  email: string;

  @ApiProperty({
    example: '3101234567',
    description: 'Número de teléfono del usuario (solo números, 10 dígitos)',
    required: true,
    uniqueItems: true,
  })
  @IsString({ message: 'El teléfono debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El número de teléfono es obligatorio' })
  @Matches(/^[0-9]{10}$/, {
    message: 'El teléfono debe contener exactamente 10 dígitos numéricos',
  })
  phone: string;

  @ApiProperty({
    example: 'MiPassword123!',
    description: 'Contraseña segura del usuario',
    required: true,
    minLength: 8,
  })
  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'La contraseña debe contener al menos: 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial (@$!%*?&)',
  })
  password: string;

  @IsOptional()
  roles?: string[];
}
