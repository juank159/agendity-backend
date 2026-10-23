/**
 * Tarea 1.01: toda ruta que no esté marcada con @Public() debe responder 401 sin token.
 *
 * - Lee todas las rutas del documento Swagger de la app real (mismo setup que main.ts).
 * - Solo hace peticiones SIN token válido: los guards cortan antes del handler,
 *   así que el test no escribe en la BD.
 */
import { INestApplication, RequestMethod } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { allowFictitiousAccounts, signToken } from './utils/dev-fixtures';
import { AppointmentReminderService } from '../src/appointments/appointment-reminder.service';

/** Rutas públicas aprobadas (método + ruta Swagger). Cualquier cambio se revisa. */
const PUBLIC_ROUTES = new Set<string>([
  'POST /api/auth/register/owner',
  'POST /api/auth/login',
  'POST /api/auth/google',
  'POST /api/auth/verify/request-code',
  'POST /api/auth/verify/email',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/webhooks/wompi',
  // Solo existe con NODE_ENV=development (DemoPaymentModule).
  'GET /api/demo-payment',
]);

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
const FAKE_UUID = '00000000-0000-4000-8000-000000000000';

interface Route {
  method: HttpMethod;
  swaggerPath: string;
  url: string;
  key: string;
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .map((p) => (p ?? '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

describe('Guard JWT global (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let routes: Route[];
  let jwt: JwtService;

  beforeAll(async () => {
    const created = await createE2EApp([DiscoveryModule]);
    app = created.app;
    http = created.http;
    close = created.close;
    allowFictitiousAccounts(app, [FAKE_UUID]);
    const document = created.document;

    routes = [];
    for (const [swaggerPath, item] of Object.entries(document.paths)) {
      for (const method of HTTP_METHODS) {
        if (!(item as Record<string, unknown>)[method]) continue;
        routes.push({
          method,
          swaggerPath,
          url: swaggerPath.replace(/\{[^}]+\}/g, FAKE_UUID),
          key: `${method.toUpperCase()} ${swaggerPath}`,
        });
      }
    }

    jwt = new JwtService({ secret: process.env.SECRET_KEY_JWT });
  }, 60000);

  afterAll(async () => {
    await close?.();
  });

  it('Swagger expone las rutas de la app', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('las rutas con @Public() son exactamente las aprobadas', () => {
    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);
    const found = new Set<string>();

    for (const wrapper of discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const classPath: string = Reflect.getMetadata(PATH_METADATA, metatype);
      const proto = Object.getPrototypeOf(instance);
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );
        if (verb === undefined) continue;
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          metatype,
        ]);
        if (!isPublic) continue;
        const methodPath: string = Reflect.getMetadata(PATH_METADATA, handler);
        const path = joinPath('api', classPath, methodPath).replace(
          /:([A-Za-z0-9_]+)/g,
          '{$1}',
        );
        found.add(`${RequestMethod[verb]} ${path}`);
      }
    }

    const expected = new Set(PUBLIC_ROUTES);
    if (process.env.NODE_ENV !== 'development') {
      expected.delete('GET /api/demo-payment');
    }
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it('demo-payment solo se registra en desarrollo', () => {
    const registered = routes.some((r) => r.key === 'GET /api/demo-payment');
    expect(registered).toBe(process.env.NODE_ENV === 'development');
  });

  (process.env.NODE_ENV === 'development' ? it : it.skip)(
    'demo-payment no refleja parámetros sin escapar (XSS)',
    async () => {
      const payload = `"><script>alert(1)</script>`;
      const res = await http
        .get('/api/demo-payment')
        .query({ reference: payload, redirect: `javascript:alert(1)//` });
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('<script>alert(1)');
      expect(res.text).not.toContain('javascript:');
      expect(res.text).toContain('demo_reference');
    },
  );

  it('ninguna ruta estática queda detrás de una :param del mismo método que la capture', () => {
    // Orden real de registro en Express: la primera ruta que encaja gana.
    const layers = app
      .getHttpAdapter()
      .getInstance()
      ._router.stack.filter(
        (l) => l.route && String(l.route.path).startsWith('/api/'),
      )
      .map((l) => ({
        path: l.route.path as string,
        methods: Object.keys(l.route.methods),
        regexp: l.regexp as RegExp,
      }));
    const shadowed: string[] = [];
    layers.forEach((later, j) => {
      const sample = later.path.replace(/:[^/]+/g, 'x1');
      for (const earlier of layers.slice(0, j)) {
        if (earlier.path === later.path) continue;
        const sameMethod = earlier.methods.some((m) =>
          later.methods.includes(m),
        );
        if (sameMethod && earlier.regexp.test(sample)) {
          shadowed.push(`${later.path} queda detrás de ${earlier.path}`);
        }
      }
    });
    expect(layers.length).toBeGreaterThan(100);
    expect(shadowed).toEqual([]);
  });

  it('GET /appointments/check-reminders llega a su handler (no a :id)', async () => {
    // Mockeado: el real programa envíos de recordatorios.
    const check = jest
      .spyOn(app.get(AppointmentReminderService), 'checkAndScheduleReminders')
      .mockResolvedValue(undefined);
    const token = signToken(
      { id: FAKE_UUID, name: 'e2e', email: 'e2e@test.local' },
      ['Owner'],
    );
    const res = await http
      .get('/api/appointments/check-reminders')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(check).toHaveBeenCalledTimes(1);
    check.mockRestore();
  });

  it('toda ruta no pública responde 401 sin token', async () => {
    const failures: string[] = [];
    for (const route of routes) {
      if (PUBLIC_ROUTES.has(route.key)) continue;
      const res = await http[route.method](route.url);
      if (res.status !== 401) failures.push(`${route.key} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
    // Rutas comprobadas, para que el resultado sea visible en la salida del test.
    console.info(
      `Rutas: ${routes.length} · protegidas comprobadas: ${
        routes.filter((r) => !PUBLIC_ROUTES.has(r.key)).length
      }`,
    );
  });

  it('toda ruta no pública responde 401 con un token inválido', async () => {
    const failures: string[] = [];
    const forged = jwt.sign(
      { id: FAKE_UUID, roles: ['Admin', 'Owner', 'Employee'] },
      { secret: 'no-es-el-secreto' },
    );
    for (const route of routes) {
      if (PUBLIC_ROUTES.has(route.key)) continue;
      const res = await http[route.method](route.url).set(
        'Authorization',
        `Bearer ${forged}`,
      );
      if (res.status !== 401) failures.push(`${route.key} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('el guard de roles global responde 403 si falta el rol', async () => {
    const ownerToken = signToken(
      { id: FAKE_UUID, name: 'e2e', email: 'e2e@test.local' },
      ['Owner'],
    );
    // Rutas solo para Admin: el guard corta antes del handler (no toca la BD).
    const adminOnly: Array<[HttpMethod, string]> = [
      ['get', '/api/roles'],
      ['post', '/api/roles'],
      ['get', '/api/schedules'],
      ['get', '/api/notifications'],
      ['post', `/api/subscriptions/plans`],
    ];
    for (const [method, url] of adminOnly) {
      const res = await http[method](url).set(
        'Authorization',
        `Bearer ${ownerToken}`,
      );
      expect(`${method} ${url} -> ${res.status}`).toBe(
        `${method} ${url} -> 403`,
      );
    }
  });
});
