import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from './has.roles';
import { JwtRoles } from './jwt.role';

/**
 * Guard de roles global (registrado como `APP_GUARD` después de `JwtAuthGuard`).
 * Aplica `@hasRoles(...)`; sin ese decorador basta con estar autenticado.
 */
@Injectable()
export class JwtRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<JwtRoles[]>(
      ROLES_KEY,
      targets,
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const hasRole = requiredRoles.some((role) => user?.roles?.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `No tienes privilegios para acceder a esta ruta. Se requiere uno de los roles: ${requiredRoles.join(', ')}`,
      );
    }
    return true;
  }
}
