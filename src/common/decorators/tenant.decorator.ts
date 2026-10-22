import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from 'src/auth/interfaces';

/**
 * Lee el tenant efectivo de la petición (`AuthUser.tenantId`, que deja `JwtStrategy`).
 * Lanza 401 si no existe: nunca se consulta "sin tenant", porque TypeORM ignora
 * `where: { ownerId: undefined }` y devolvería datos de cualquier negocio.
 */
export function tenantIdFrom(user: AuthUser | undefined): string {
  if (!user?.tenantId) {
    throw new UnauthorizedException('Sesión sin negocio asociado');
  }
  return user.tenantId;
}

/**
 * Id del negocio (tenant) de quien llama: el id del Owner para el Owner y para
 * sus empleados. Es el valor que se guarda en `owner_id` y por el que se filtra.
 *
 * Uso: `findAll(@Tenant() tenantId: string)`. Si además hace falta el id o los
 * roles de quien llama, se añade `@CurrentUser()`.
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    tenantIdFrom(ctx.switchToHttp().getRequest().user as AuthUser | undefined),
);
