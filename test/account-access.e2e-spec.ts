/**
 * Tarea 2.12: acceso de cuentas desactivadas, borradas o sin negocio, en el
 * login y con un token ya emitido (JwtStrategy comprueba la cuenta en cada
 * petición). Escribe de verdad: SOLO contra una copia temporal de la BD
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`). En la corrida normal se omite.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { EmailService } from '../src/email/email.service';
import { ACCOUNT_BLOCK_MESSAGES } from '../src/auth/account-access';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable(
  `Acceso de cuentas (2.12) contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let ownerToken: string;
    let employeeId: string;
    /** Token emitido por el login real antes de cambiar la cuenta. */
    let sessionToken: string;

    const suffix = String(Date.now()).slice(-9);
    const email = `e2e.212.${suffix}@agendity.test`;
    const password = 'Clave123!';

    const login = () => http.post('/api/auth/login').send({ email, password });
    /** Una lectura que el Employee puede hacer. */
    const useSession = () =>
      http.get('/api/categories').set(auth(sessionToken));

    async function expectLoginBlocked(
      block: keyof typeof ACCOUNT_BLOCK_MESSAGES,
    ) {
      const res = await login();
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        message: ACCOUNT_BLOCK_MESSAGES[block],
      });
      expect(res.body.token).toBeUndefined();
    }

    async function expectSessionRejected() {
      const res = await useSession();
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      jest
        .spyOn(EmailService.prototype, 'sendVerificationCode')
        .mockResolvedValue(true);
      ({ owner } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('el alta ya no devuelve un JWT del empleado al Owner', async () => {
      // Sin horario: un empleado borrado deja sus horarios sin usuario visible
      // y eso rompería `user-secrets` sobre la misma copia.
      const res = await http
        .post('/api/auth/register/employee')
        .set(auth(ownerToken))
        .send({
          name: 'Prueba',
          lastname: 'Acceso',
          email,
          phone: `3${suffix}`,
          password,
        });
      expect(res.status).toBe(201);
      expect(res.body.token).toBeUndefined();
      expect(res.body.user.isActive).toBe(false);
      employeeId = res.body.user.id;
    });

    it('recién creado (sin verificar): el login responde 403 con el motivo', async () => {
      await expectLoginBlocked('NOT_VERIFIED');
    });

    it('contraseña incorrecta: sigue siendo 401 "Credenciales inválidas" (no revela el estado)', async () => {
      const res = await http
        .post('/api/auth/login')
        .send({ email, password: 'Otra123!x' });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Credenciales inválidas');
    });

    it('verificado: entra y su token funciona', async () => {
      await http.post('/api/auth/verify/request-code').send({ email });
      const [{ code }] = await ds.query(
        'SELECT verification_code AS code FROM users WHERE id = $1',
        [employeeId],
      );
      const verify = await http
        .post('/api/auth/verify/employee-email')
        .set(auth(ownerToken))
        .send({ employee_id: employeeId, code });
      expect(verify.status).toBe(201);

      const res = await login();
      expect(res.status).toBe(200);
      sessionToken = res.body.token;
      expect((await useSession()).status).toBe(200);
    });

    it('desactivado: el token vigente deja de servir (401) y el login da 403; reactivado vuelve a servir', async () => {
      const off = await http
        .patch(`/api/auth/employee/${employeeId}/status`)
        .set(auth(ownerToken))
        .send({ isActive: false });
      expect(off.status).toBe(200);
      await expectSessionRejected();
      await expectLoginBlocked('DEACTIVATED');

      const on = await http
        .patch(`/api/auth/employee/${employeeId}/status`)
        .set(auth(ownerToken))
        .send({ isActive: true });
      expect(on.status).toBe(200);
      expect((await useSession()).status).toBe(200);
    });

    it('borrado (soft-delete): token 401 y login 403', async () => {
      const del = await http
        .delete(`/api/auth/employee/${employeeId}`)
        .set(auth(ownerToken))
        .send({ reason: 'e2e 2.12' });
      expect(del.status).toBe(200);
      await expectSessionRejected();
      await expectLoginBlocked('DELETED');
    });

    it('huérfano (sin owner): token 401 y login 403, en vez de quedar como su propio tenant', async () => {
      const restore = await http
        .patch(`/api/auth/employee/${employeeId}/restore`)
        .set(auth(ownerToken));
      expect(restore.status).toBe(200);
      expect((await useSession()).status).toBe(200);

      await assertWritableDatabase(ds);
      await ds.query('UPDATE users SET owner_id = NULL WHERE id = $1', [
        employeeId,
      ]);
      await expectSessionRejected();
      await expectLoginBlocked('NO_BUSINESS');
    });
  },
);
