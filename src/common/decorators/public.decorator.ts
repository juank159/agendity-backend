import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta (o un controller entero) como pública: el `JwtAuthGuard`
 * global no exige token. Usar solo en rutas que el negocio necesita sin sesión
 * (login, registro, verificación, recuperación de contraseña, webhooks).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
