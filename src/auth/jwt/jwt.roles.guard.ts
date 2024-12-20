import { ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtRoles } from "./jwt.role";

@Injectable()
export class JwtRolesGuard {
  constructor(private reflector: Reflector) {}
    
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<JwtRoles[]>('roles',[
        context.getHandler(), context.getClass(),
        context.getClass()
    ]);
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    const hasRole = requiredRoles.some((role) => user.roles?.includes(role));
    if (!hasRole) {
      throw new ForbiddenException(
        `No tienes privilegios para acceder a esta ruta. Se requiere uno de los roles: ${requiredRoles.join(', ')}`
      );
    }
    return true;
  }
}