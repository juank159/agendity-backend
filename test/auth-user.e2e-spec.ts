/**
 * Tarea 2.01: `JwtStrategy` construye el `AuthUser` con el tenant real.
 * - Owner: tenantId = su id. Employee: tenantId = id de su owner.
 * - Los tokens anteriores a 2.01 (sin `tenantId`) siguen valiendo: el tenant se
 *   resuelve en la BD. Si el usuario no existe, 401.
 *
 * SOLO LECTURA: `GET /subscriptions/status` solo consulta (no crea el trial).
 */
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

const UNKNOWN_ID = '00000000-0000-4000-8000-0000000002d1';

describe('AuthUser y tenant (e2e)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;
  let owner: User;
  let employee: User | null;
  let jwt: JwtService;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Token como los firmaba el login antes de 2.01 (sin tenantId/ownerId). */
  const legacyToken = (
    user: Pick<User, 'id' | 'name' | 'email' | 'tenant_id'>,
    roles: string[],
  ) =>
    jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        roles,
        tenant_id: user.tenant_id,
      },
      { expiresIn: '5m' },
    );

  beforeAll(async () => {
    let app;
    ({ app, http, close } = await createE2EApp());
    ({ owner, employee } = await findDevOwnerAndEmployee(app.get(DataSource)));
    jwt = new JwtService({ secret: process.env.SECRET_KEY_JWT });
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await close();
  });

  it('el Owner consulta la suscripción de su tenant (= su id)', async () => {
    const res = await http
      .get('/api/subscriptions/status')
      .set(auth(signToken(owner, ['Owner'])));
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) expect(res.body.tenant_id).toBe(owner.id);
  });

  it('un token anterior a 2.01 da el mismo resultado que uno nuevo', async () => {
    const fresh = await http
      .get('/api/subscriptions/status')
      .set(auth(signToken(owner, ['Owner'])));
    const legacy = await http
      .get('/api/subscriptions/status')
      .set(auth(legacyToken(owner, ['Owner'])));
    expect(legacy.status).toBe(fresh.status);
    expect(legacy.body.id).toBe(fresh.body.id);
  });

  it('el Employee ve la suscripción del negocio de su owner', async () => {
    if (!employee) return; // la BD de dev no tiene empleado
    const asOwner = await http
      .get('/api/subscriptions/status')
      .set(auth(signToken(owner, ['Owner'])));
    for (const token of [
      signToken(employee, ['Employee']),
      legacyToken(employee, ['Employee']),
    ]) {
      const res = await http.get('/api/subscriptions/status').set(auth(token));
      expect(res.status).toBe(asOwner.status);
      expect(res.body.id).toBe(asOwner.body.id);
    }
  });

  it('GET /auth/me: Owner y Employee reciben su usuario (campos fijos, sin secretos) con su tenant (2.35)', async () => {
    const fields = [
      'email',
      'id',
      'image',
      'isActive',
      'is_email_verified',
      'lastname',
      'name',
      'phone',
      'roles',
      'tenantId',
      'timezone', // 6.01: zona del negocio
    ];
    const asOwner = await http
      .get('/api/auth/me')
      .set(auth(signToken(owner, ['Owner'])));
    expect(asOwner.status).toBe(200);
    expect(Object.keys(asOwner.body).sort()).toEqual(fields);
    expect(asOwner.body).toMatchObject({
      id: owner.id,
      email: owner.email,
      tenantId: owner.id,
      is_email_verified: owner.is_email_verified,
    });
    const settings = await http
      .get('/api/settings')
      .set(auth(signToken(owner, ['Owner'])));
    expect(asOwner.body.timezone).toBe(settings.body.timezone);
    expect(asOwner.body.roles).toEqual(
      expect.arrayContaining([{ name: 'Owner' }]),
    );

    if (!employee) return; // la BD de dev no tiene empleado
    const asEmployee = await http
      .get('/api/auth/me')
      .set(auth(signToken(employee, ['Employee'])));
    expect(asEmployee.status).toBe(200);
    expect(Object.keys(asEmployee.body).sort()).toEqual(fields);
    expect(asEmployee.body).toMatchObject({
      id: employee.id,
      tenantId: owner.id,
      timezone: asOwner.body.timezone, // la del negocio de su owner
    });
  });

  it('GET /auth/me sin sesión → 401', async () => {
    const res = await http.get('/api/auth/me');
    expect([res.status, res.body.code]).toEqual([401, 'UNAUTHORIZED']);
  });

  it('un token anterior a 2.01 de un usuario inexistente responde 401', async () => {
    const res = await http.get('/api/subscriptions/status').set(
      auth(
        legacyToken(
          {
            id: UNKNOWN_ID,
            name: 'x',
            email: 'x@e2e.local',
            tenant_id: null,
          },
          ['Owner'],
        ),
      ),
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
