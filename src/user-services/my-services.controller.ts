import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { AuthUser } from '../auth/interfaces';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserServicesService } from './user-services.service';

/**
 * Servicios de quien llama (2026-10-31): la empleada no puede leer el equipo
 * (`GET /auth/employees` es solo del Owner), y la app necesita su catálogo
 * para crear sus citas. Vive en este módulo (no en `AuthModule`) para no
 * volver a crear el ciclo Auth → UserServices → Users → Auth.
 */
@ApiTags('Usuario de la sesión')
@Controller('auth/me')
export class MyServicesController {
  constructor(private readonly userServices: UserServicesService) {}

  @Get('services')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findMine(@CurrentUser() user: AuthUser) {
    return this.userServices.findMine(user);
  }
}
