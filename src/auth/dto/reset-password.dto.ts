// dto/reset-password.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  Matches,
  Length,
} from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'juan.perez@example.com',
    description: 'Correo electrónico del usuario',
    required: true,
  })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  @IsString({ message: 'El correo debe ser una cadena de texto' })
  @IsEmail({}, { message: 'Debe ser un correo electrónico válido' })
  @Length(5, 100, { message: 'El correo debe tener entre 5 y 100 caracteres' })
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'Código de verificación de 6 dígitos',
    required: true,
  })
  @IsNotEmpty({ message: 'El código de verificación es obligatorio' })
  @IsString({ message: 'El código debe ser una cadena de texto' })
  @Matches(/^[0-9]{6}$/, {
    message: 'El código debe contener exactamente 6 dígitos numéricos',
  })
  code: string;

  @ApiProperty({
    example: 'MiNuevaPassword123!',
    description: 'Nueva contraseña segura del usuario',
    required: true,
    minLength: 8,
  })
  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'La contraseña debe contener al menos: 1 mayúscula, 1 minúscula, 1 número y 1 carácter especial (@$!%*?&)',
  })
  newPassword: string;
}
