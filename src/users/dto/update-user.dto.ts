import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Datos de perfil editables por `PATCH /users/:id`.
 * `password` y `email` NO están: con `forbidNonWhitelisted` (ValidationPipe global)
 * enviarlos responde 400. La contraseña solo cambia por el flujo de reset (con hash).
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  lastname?: string;

  // Misma regla que el registro (10 dígitos). Antes aceptaba '' y chocaba con el índice único (2.10).
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}$/, {
    message: 'El teléfono debe contener exactamente 10 dígitos numéricos',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  notification_token?: string;
}
