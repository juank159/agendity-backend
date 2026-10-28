import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

/** Petición con la zona del tenant ya resuelta por `TenantTimeZoneInterceptor`. */
export interface TimeZoneRequest {
  tenantTimeZone?: string;
}

/**
 * Zona IANA del tenant de la sesión (6.02). La resuelve
 * `TenantTimeZoneInterceptor` antes del handler; si falta es un error de
 * programación (ruta sin sesión): 500, nunca una zona inventada.
 */
export function timeZoneFrom(request: TimeZoneRequest): string {
  if (!request?.tenantTimeZone) {
    throw new InternalServerErrorException(
      'Zona horaria del negocio no resuelta',
    );
  }
  return request.tenantTimeZone;
}

/** `@TenantTimeZone() timeZone: string` en un handler con sesión. */
export const TenantTimeZone = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    timeZoneFrom(ctx.switchToHttp().getRequest<TimeZoneRequest>()),
);
