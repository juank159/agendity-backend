import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { AuthUser, isOnlyEmployee } from 'src/auth/interfaces';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { tenantIdFrom } from 'src/common/decorators/tenant.decorator';
import { SyncChangesQueryDto } from './dto/sync-changes-query.dto';
import { SyncService } from './sync.service';

/** Sincronización para la app sin conexión (10.01a, D-18). */
@ApiTags('Sincronización')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Cambios del negocio desde `cursor` (paginado por versión): filas nuevas o
   * cambiadas (`upsert`), borradas (`delete`) y las que ya no son tuyas
   * (`leave_scope`). Owner: todo el negocio; Employee: lo que hoy le devuelve
   * la API (sus citas y bloqueos; sin pagos, métodos de pago ni reseñas).
   */
  @Get('changes')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  changes(@CurrentUser() user: AuthUser, @Query() query: SyncChangesQueryDto) {
    return this.sync.changes(
      {
        tenantId: tenantIdFrom(user),
        userId: user.id,
        employee: isOnlyEmployee(user),
      },
      query.cursor,
      query.limit,
    );
  }
}
