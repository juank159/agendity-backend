import { lastValueFrom, of } from 'rxjs';
import {
  requestTimeZone,
  runWithRequestTimeZone,
} from 'src/common/context/request-time-zone';
import { TenantTimeZoneInterceptor } from './tenant-time-zone.interceptor';

function contextFor(request: Record<string, unknown>, type = 'http') {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('TenantTimeZoneInterceptor (6.02)', () => {
  const settings = {
    getTimezone: jest.fn(async (tenantId: string) =>
      tenantId === 'caracas' ? 'America/Caracas' : 'America/Bogota',
    ),
  };
  const interceptor = new TenantTimeZoneInterceptor(settings as any);
  beforeEach(() => settings.getTimezone.mockClear());

  it('con sesión: deja la zona del tenant en la petición y en el contexto de la respuesta', async () => {
    const request: Record<string, any> = { user: { tenantId: 'caracas' } };
    await runWithRequestTimeZone(undefined, async () => {
      const seen = await lastValueFrom(
        interceptor.intercept(contextFor(request), {
          handle: () => of(requestTimeZone()),
        }),
      );
      expect(seen).toBe('America/Caracas');
      expect(request.tenantTimeZone).toBe('America/Caracas');
    });
    expect(settings.getTimezone).toHaveBeenCalledWith('caracas');
  });

  it('sin sesión (ruta pública): no consulta ni fija zona (respuesta en UTC)', async () => {
    const request: Record<string, any> = {};
    await runWithRequestTimeZone(undefined, async () => {
      const seen = await lastValueFrom(
        interceptor.intercept(contextFor(request), {
          handle: () => of(requestTimeZone()),
        }),
      );
      expect(seen).toBeUndefined();
    });
    expect(request.tenantTimeZone).toBeUndefined();
    expect(settings.getTimezone).not.toHaveBeenCalled();
  });
});
