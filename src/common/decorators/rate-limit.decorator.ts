import { applyDecorators, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

const ONE_MINUTE_MS = 60_000;

/**
 * Límite de peticiones por IP para una ruta concreta (`ThrottlerModule` en AppModule).
 * Solo se aplica donde se pone este decorador: el resto de la app no tiene throttle.
 * Al pasarse responde 429.
 *
 * Nota de despliegue: detrás de un proxy hay que poner `TRUST_PROXY` (D.02)
 * para que la IP sea la del cliente y no la del proxy.
 */
export const RateLimit = (limit: number, ttlMs: number = ONE_MINUTE_MS) =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({ default: { limit, ttl: ttlMs } }),
  );

/** Límites de `/auth/*` por IP y por minuto. */
export const AUTH_RATE_LIMITS = {
  login: 10,
  google: 10,
  registerOwner: 5,
  requestCode: 5,
  forgotPassword: 3,
  verifyCode: 10,
} as const;
