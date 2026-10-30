import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { AuthUser, isOnlyEmployee } from 'src/auth/interfaces';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { tenantIdFrom } from 'src/common/decorators/tenant.decorator';
import { SyncChangesQueryDto } from './dto/sync-changes-query.dto';
import { SyncService } from './sync.service';
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncPushService } from './sync-push.service';

/** Sincronización para la app sin conexión (10.01a, D-18). */
@ApiTags('Sincronización')
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly pushService: SyncPushService,
  ) {}

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

  /**
   * Sube lo hecho sin conexión (10.01b): un lote ordenado de operaciones de
   * negocio, idempotente por `mutation_id`. Un resultado por mutación:
   * `applied`, `conflict` (con `code`; `saved` si quedó guardada para
   * revisar), `rejected`, `merged` (cliente fusionado: `merged_into`) o
   * `retry`. Mismos permisos que las rutas online.
   */
  @Post('push')
  @HttpCode(200)
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  push(@CurrentUser() user: AuthUser, @Body() dto: SyncPushDto) {
    return this.pushService.push(user, dto);
  }
}
