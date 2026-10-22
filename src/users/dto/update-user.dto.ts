import { IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  notification_token?: string;
}
