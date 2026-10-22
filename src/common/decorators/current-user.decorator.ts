import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthUser } from 'src/auth/interfaces';

/** Usuario autenticado (`AuthUser`) que dejó `JwtStrategy` en la petición. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado en la solicitud');
    }
    return user;
  },
);
