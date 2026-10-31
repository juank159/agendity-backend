/**
 * Tarea 6.01 (D-15): configuración del negocio con su zona horaria.
 *
 * - Bloque de solo lectura (corre siempre): GET por rol, PATCH del Employee
 *   (403), zona inválida (400) y PATCH idempotente; escrituras bloqueadas.
 * - Bloque que escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`):
 *   PATCH del Owner, aislamiento entre negocios y alta con zona (email y
 *   Google).
 */
import { INestApplication } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { TenantSettingsService } from '../src/settings/tenant-settings.service';
import { defaultBusinessTimeZone } from '../src/common/utils/date.util';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import { assertWritableDatabase, describeWritable } from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const INVALID_MESSAGE =
  'La zona horaria no es válida: usa un nombre IANA, por ejemplo America/Bogota';

describe('Configuración del negocio 6.01 (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let owner: User;
  let employee: User | null;
  const writes: string[] = [];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ({ owner, employee } = await findDevOwnerAndEmployee(app.get(DataSource)));
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    writes.length = 0;
    const block = (proto: object, methods: string[], label: string) =>
      methods.forEach((m) =>
        jest.spyOn(proto as any, m).mockImplementation(() => {
          writes.push(`${label}.${m}`);
          throw new Error('Escritura bloqueada en un test de solo lectura');
        }),
      );
    block(
      Repository.prototype,
      ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
      'Repository',
    );
    block(
      EntityManager.prototype,
      ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
      'EntityManager',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(writes).toEqual([]);
  });

  afterAll(async () => {
    await close();
  });

  it('GET /settings: Owner y Employee ven la zona de su negocio', async () => {
    const asOwner = await http
      .get('/api/settings')
      .set(auth(signToken(owner, ['Owner'])));
    expect(asOwner.status).toBe(200);
    // 8.00/8.01: también nombre, slug y horario del negocio.
    expect(Object.keys(asOwner.body).sort()).toEqual([
      'booking_url', // D.02
      'name',
      'opening_hours',
      'slug',
      'timezone',
    ]);
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: asOwner.body.timezone,
      }).resolvedOptions().timeZone,
    ).toBe(asOwner.body.timezone);

    if (!employee) return; // la BD de dev no tiene empleado
    const asEmployee = await http
      .get('/api/settings')
      .set(auth(signToken(employee, ['Employee'])));
    expect(asEmployee.status).toBe(200);
    expect(asEmployee.body).toEqual(asOwner.body);
  });

  it('GET /settings sin sesión → 401', async () => {
    const res = await http.get('/api/settings');
    expect([res.status, res.body.code]).toEqual([401, 'UNAUTHORIZED']);
  });

  it('PATCH /settings como Employee → 403 FORBIDDEN', async () => {
    if (!employee) return;
    const res = await http
      .patch('/api/settings')
      .set(auth(signToken(employee, ['Employee'])))
      .send({ timezone: 'America/Caracas' });
    expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
  });

  it.each([
    ['Mars/Phobos'],
    ['-05:00'],
    ['Bogota'],
    [''],
    [5],
    [['America/Bogota']],
  ])(
    'PATCH /settings con zona inválida %p → 400 VALIDATION_ERROR',
    async (timezone) => {
      const res = await http
        .patch('/api/settings')
        .set(auth(signToken(owner, ['Owner'])))
        .send({ timezone });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: INVALID_MESSAGE,
      });
    },
  );

  it('PATCH /settings con un campo desconocido → 400 VALIDATION_ERROR', async () => {
    const res = await http
      .patch('/api/settings')
      .set(auth(signToken(owner, ['Owner'])))
      .send({ tenant_id: employee?.id ?? owner.id });
    expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('PATCH /settings con la misma zona: 200 y no escribe', async () => {
    const token = auth(signToken(owner, ['Owner']));
    const current = await http.get('/api/settings').set(token);
    const res = await http
      .patch('/api/settings')
      .set(token)
      .send({ timezone: current.body.timezone });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(current.body);
  });
});

describeWritable(
  'Configuración del negocio 6.01 (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User | null;
    let original: string;
    const run = randomUUID().slice(0, 8);
    /** Owners creados aquí. `register/owner` admite 5 por minuto: este bloque hace 5. */
    const created: string[] = [];

    const zoneOf = async (tenantId: string): Promise<string | undefined> =>
      (
        await ds.query(
          'SELECT timezone FROM business_settings WHERE tenant_id = $1',
          [tenantId],
        )
      )[0]?.timezone;

    const phone = (n: number) => `3${(Date.now() + n).toString().slice(-9)}`;

    const register = (email: string, n: number, extra: object = {}) =>
      http.post('/api/auth/register/owner').send({
        name: 'Zona',
        lastname: 'Prueba',
        email,
        phone: phone(n),
        password: 'Secreta1!',
        ...extra,
      });

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      ({ owner, employee } = await findDevOwnerAndEmployee(ds));
      original = (await zoneOf(owner.id)) ?? defaultBusinessTimeZone();
    }, E2E_BOOT_TIMEOUT_MS);

    afterEach(() => jest.restoreAllMocks());

    afterAll(async () => {
      await ds.query(
        'UPDATE business_settings SET timezone = $2 WHERE tenant_id = $1',
        [owner.id, original],
      );
      app.get(TenantSettingsService).clearCache();
      await close();
    });

    it('PATCH del Owner: guarda la zona canónica; el Employee y /auth/me la ven al momento (caché invalidada)', async () => {
      const ownerToken = auth(signToken(owner, ['Owner']));
      // Llena la caché con la zona actual.
      await http.get('/api/auth/me').set(ownerToken);

      const res = await http
        .patch('/api/settings')
        .set(ownerToken)
        .send({ timezone: 'america/caracas' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ timezone: 'America/Caracas' });
      expect(await zoneOf(owner.id)).toBe('America/Caracas');

      const me = await http.get('/api/auth/me').set(ownerToken);
      expect(me.body.timezone).toBe('America/Caracas');
      if (employee) {
        const asEmployee = await http
          .get('/api/settings')
          .set(auth(signToken(employee, ['Employee'])));
        expect(asEmployee.body).toMatchObject({ timezone: 'America/Caracas' });
      }

      const madrid = await http
        .patch('/api/settings')
        .set(ownerToken)
        .send({ timezone: 'Europe/Madrid' });
      expect(madrid.body).toMatchObject({ timezone: 'Europe/Madrid' });
    });

    it('alta por email con la zona del dispositivo: fila en business_settings con esa zona; sin zona o inválida: BUSINESS_TIMEZONE', async () => {
      const cases: [string, object, string][] = [
        [
          `tz1-${run}@example.com`,
          { timezone: 'America/Caracas' },
          'America/Caracas',
        ],
        [`tz2-${run}@example.com`, {}, defaultBusinessTimeZone()],
        [
          `tz3-${run}@example.com`,
          { timezone: 'Mars/Phobos' },
          defaultBusinessTimeZone(),
        ],
      ];
      let n = 0;
      for (const [email, extra, expected] of cases) {
        const res = await register(email, ++n, extra);
        expect(res.status).toBe(201);
        expect(res.body.user).not.toHaveProperty('timezone');
        expect(await zoneOf(res.body.user.id)).toBe(expected);
        created.push(res.body.user.id);

        const settings = await http
          .get('/api/settings')
          .set(auth(res.body.token));
        expect(settings.body).toMatchObject({ timezone: expected });
      }
    });

    it('dos negocios en zonas distintas no se cruzan: el PATCH de uno no cambia al otro', async () => {
      const a = await register(`tz-a-${run}@example.com`, 10, {
        timezone: 'America/Bogota',
      });
      const b = await register(`tz-b-${run}@example.com`, 11, {
        timezone: 'America/Bogota',
      });
      const patch = await http
        .patch('/api/settings')
        .set(auth(a.body.token))
        .send({ timezone: 'America/Caracas' });
      expect(patch.status).toBe(200);
      const [settingsA, settingsB] = await Promise.all([
        http.get('/api/settings').set(auth(a.body.token)),
        http.get('/api/settings').set(auth(b.body.token)),
      ]);
      expect(settingsA.body).toMatchObject({ timezone: 'America/Caracas' });
      expect(settingsB.body).toMatchObject({ timezone: 'America/Bogota' });
    });

    it('alta nueva por Google con la zona del dispositivo', async () => {
      const email = `tz-g-${run}@gmail.com`;
      jest
        .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
        .mockResolvedValue({
          getPayload: () => ({
            email,
            email_verified: true,
            name: 'Zona Google',
          }),
        });
      const res = await http
        .post('/api/auth/google')
        .send({ token: 'google-id-token', timezone: 'Europe/Madrid' });
      expect(res.status).toBe(200);
      expect(await zoneOf(res.body.user.id)).toBe('Europe/Madrid');
    });

    it('la configuración se borra con el Owner (ON DELETE CASCADE)', async () => {
      const id = created[created.length - 1]; // alta del test anterior
      expect(await zoneOf(id)).toBeDefined();
      await ds.transaction(async (m) => {
        await m.query('DELETE FROM subscriptions WHERE tenant_id = $1', [id]);
        await m.query('DELETE FROM users WHERE id = $1', [id]);
      });
      expect(await zoneOf(id)).toBeUndefined();
    });
  },
);
