/**
 * Tarea 2.10: login con Google sin teléfono y con el JWT propio de Agendity.
 *
 * - Bloque de solo lectura (corre siempre): escrituras de TypeORM bloqueadas.
 * - Bloque que escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`):
 *   dos altas nuevas de Google (con su trial, 2.19) y `request-code` sin
 *   registros temporales (2.19).
 *
 * El ID token de Google se simula (`OAuth2Client.prototype.verifyIdToken`) y
 * el email no se envía (`EmailService.sendVerificationCode` mockeado).
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { EmailService } from '../src/email/email.service';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import { assertWritableDatabase, describeWritable } from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const googleTicket = (email: string, name = 'Ana María Pérez') =>
  ({
    getPayload: () => ({ email, email_verified: true, name }),
  }) as any;

describe('Login con Google 2.10 (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let owner: User;
  const writes: string[] = [];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ({ owner } = await findDevOwnerAndEmployee(app.get(DataSource)));
  });

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
      ['save', 'insert', 'update', 'remove', 'delete'],
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

  it('token de Google rechazado → 401 UNAUTHORIZED, sin detalle interno ni escrituras', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockRejectedValue(new Error('Wrong recipient (detalle interno)'));
    const res = await http.post('/api/auth/google').send({ token: 'x' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Token de Google inválido',
    });
    expect(JSON.stringify(res.body)).not.toContain('detalle interno');
  });

  it("PATCH /users/:id con phone '' → 400 (ya no deja guardar cadenas vacías)", async () => {
    const res = await http
      .patch(`/api/users/${owner.id}`)
      .set(auth(signToken(owner, ['Owner'])))
      .send({ phone: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describeWritable('Login con Google 2.10 (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  const run = randomUUID().slice(0, 8);
  const googleEmails = [`g1-${run}@gmail.com`, `g2-${run}@gmail.com`];
  const pendingEmails = [`p1-${run}@example.com`, `p2-${run}@example.com`];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await close();
  });

  it('dos usuarios nuevos de Google sin teléfono: ambos se crean con phone NULL y reciben el JWT de Agendity', async () => {
    const verify = jest.spyOn(OAuth2Client.prototype as any, 'verifyIdToken');
    const jwt = new JwtService({ secret: process.env.SECRET_KEY_JWT });

    for (const email of googleEmails) {
      verify.mockResolvedValueOnce(googleTicket(email));
      const res = await http
        .post('/api/auth/google')
        // Lo mismo que envía la app (google_auth_datasource.dart).
        .send({
          token: 'google-id-token',
          email,
          name: 'Ana',
          lastname: 'María Pérez',
          photo: null,
        });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['token', 'user']);
      expect(res.body.user).toMatchObject({
        email,
        name: 'Ana',
        lastname: 'María Pérez',
        phone: null,
        is_google_account: true,
        roles: [{ name: 'Owner' }],
      });
      expect(res.body.user).not.toHaveProperty('password');

      // JWT propio: firmado con SECRET_KEY_JWT y con el tenant = id del Owner.
      expect(res.body.token).not.toBe('google-id-token');
      const payload = jwt.verify(res.body.token);
      expect(payload).toMatchObject({
        id: res.body.user.id,
        email,
        roles: ['Owner'],
        tenantId: res.body.user.id,
        tenant_id: res.body.user.id,
      });

      // Y sirve como sesión en el resto del API.
      const status = await http
        .get('/api/subscriptions/status')
        .set(auth(res.body.token));
      expect(status.status).toBe(200);
    }

    const rows = await ds.getRepository(User).find({
      where: { email: In(googleEmails) },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((u) => u.phone === null)).toBe(true);
  });

  it('el mismo usuario de Google vuelve a entrar: no crea otra fila', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockResolvedValue(googleTicket(googleEmails[0]));
    const res = await http.post('/api/auth/google').send({ token: 't' });
    expect(res.status).toBe(200);
    expect(
      await ds.getRepository(User).count({ where: { email: googleEmails[0] } }),
    ).toBe(1);
  });

  it('request-code con isNewUser y un email desconocido: 404 y no crea fila; register/owner con ese email funciona (2.19)', async () => {
    const send = jest
      .spyOn(app.get(EmailService), 'sendVerificationCode')
      .mockResolvedValue(true);
    const [email] = pendingEmails;

    const early = await http
      .post('/api/auth/verify/request-code')
      .send({ email, isNewUser: true });
    expect(early.status).toBe(404);
    expect(await ds.getRepository(User).count({ where: { email } })).toBe(0);
    expect(send).not.toHaveBeenCalled();

    // Flujo de la app: registrar y DESPUÉS pedir el código.
    const phone = `3${Date.now().toString().slice(-9)}`;
    const register = await http.post('/api/auth/register/owner').send({
      name: 'Pendiente',
      lastname: 'Prueba',
      email,
      phone,
      password: 'Secreta1!',
    });
    expect(register.status).toBe(201);
    const code = await http
      .post('/api/auth/verify/request-code')
      .send({ email, isNewUser: true });
    expect(code.status).toBe(201);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('el alta por Google crea la fila de suscripción trial como el registro por email (2.19)', async () => {
    const rows = await ds.query(
      `SELECT u.email, s.status, s.trial_appointments_used AS used,
              s.trial_appointments_limit AS lim
         FROM users u JOIN subscriptions s ON s.tenant_id = u.id
        WHERE u.email = ANY($1) ORDER BY u.email`,
      [[...googleEmails, pendingEmails[0]]],
    );
    expect(rows).toEqual(
      [...googleEmails, pendingEmails[0]].sort().map((email) => ({
        email,
        status: 'trial',
        used: 0,
        lim: 20,
      })),
    );
  });
});
