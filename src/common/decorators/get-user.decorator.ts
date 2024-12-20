import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtPayload } from 'src/auth/interfaces';

export const GetUser = createParamDecorator(
  (data, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado en la solicitud');
    }

    return user;
  },
);
