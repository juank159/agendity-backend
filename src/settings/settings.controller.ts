import { Body, Controller, Get, Patch } from '@nestjs/common';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { Tenant } from 'src/common/decorators/tenant.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { TenantSettingsService } from './tenant-settings.service';

/** Configuración del negocio de la sesión (6.01): hoy, su zona horaria. */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: TenantSettingsService) {}

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get()
  get(@Tenant() tenantId: string) {
    return this.settingsService.getSettings(tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch()
  update(@Tenant() tenantId: string, @Body() dto: UpdateSettingsDto) {
    return this.settingsService.updateSettings(tenantId, dto);
  }
}
