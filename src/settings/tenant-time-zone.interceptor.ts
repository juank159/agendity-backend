import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, Observable, switchMap } from 'rxjs';
import { setRequestTimeZone } from 'src/common/context/request-time-zone';
import { TimeZoneRequest } from 'src/common/decorators/tenant-time-zone.decorator';
import { AuthUser } from 'src/auth/interfaces';
import { TenantSettingsService } from './tenant-settings.service';

/**
 * Zona del tenant de cada petición con sesión (6.02, D-15). Corre después de
 * los guards (ya hay `req.user`) y antes de los pipes y del handler:
 * - `req.tenantTimeZone`: la leen `@TenantTimeZone()` y `@QueryDate()` para
 *   interpretar las fechas sin offset en la zona del negocio.
 * - `setRequestTimeZone`: la usa `businessJsonReplacer` para que las fechas de
 *   la respuesta salgan con el offset de ese negocio.
 * Sin sesión (rutas públicas) no hace nada: la respuesta sale en UTC.
 * `getTimezone` está cacheado: no añade una consulta por petición.
 */
@Injectable()
export class TenantTimeZoneInterceptor implements NestInterceptor {
  constructor(private readonly settings: TenantSettingsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context
      .switchToHttp()
      .getRequest<TimeZoneRequest & { user?: AuthUser }>();
    const tenantId = request.user?.tenantId;
    if (!tenantId) return next.handle();

    return from(this.settings.getTimezone(tenantId)).pipe(
      switchMap((timeZone) => {
        request.tenantTimeZone = timeZone;
        setRequestTimeZone(timeZone);
        return next.handle();
      }),
    );
  }
}
