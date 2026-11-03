/**
 * 13.04b: `notification_token` (token de push del dispositivo) no sale en
 * ninguna respuesta: ni del profesional anidado en la cita (POST/PATCH
 * /appointments), ni en el feed de `/sync/changes`, ni en `GET/PATCH /users`.
 * Sigue guardándose (`PATCH /users/:id`) para quien lo necesite en el servidor.
 * Escribe: solo contra una copia.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import {
  assertWritableDatabase,
  describeWritable,
  firstFreeWeek,
  futureMonday,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const KEY = 'notification_token';

/** Rutas JSON (a.b[0].c) donde aparece la clave, a cualquier profundidad. */
function findKey(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findKey(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(key === KEY ? [`${path}.${key}`] : []),
      ...findKey(child, `${path}.${key}`),
    ]);
  }
  return [];
}

describeWritable(
  'notification_token fuera de las respuestas (13.04b, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let ownerToken: string;
    let employeeToken: string;
    let ownerId: string;
    let employeeId: string;
    let serviceId: string;
    let clientId: string;
    let appointmentId: string;
    let monday: string;
    const run = randomUUID().slice(0, 8);
    const employeeEmail = `push-emp-${run}@example.com`;

    const as = (req: any, token = ownerToken) => req.set(auth(token));
    const storedToken = async (id: string) =>
      (
        await ds.query(
          `SELECT notification_token AS t FROM users WHERE id = $1`,
          [id],
        )
      )[0].t;

    /** Todas las páginas del feed desde 0. */
    async function pullAll(token: string) {
      const changes: unknown[] = [];
      let cursor = '0';
      for (let i = 0; i < 200; i++) {
        const res = await http
          .get(`/api/sync/changes?cursor=${cursor}&limit=200`)
          .set(auth(token));
        expect(res.status).toBe(200);
        changes.push(...res.body.changes);
        cursor = res.body.cursor;
        if (!res.body.has_more) break;
      }
      return changes;
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Push',
        email: `push-${run}@example.com`,
        phone: `3${Date.now().toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      expect(reg.status).toBe(201);
      ownerToken = reg.body.token;
      ownerId = reg.body.user.id;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const category = await as(http.post('/api/categories')).send({
        name: `Uñas ${run}`,
      });
      serviceId = (
        await as(http.post('/api/services')).send({
          name: `Manicure ${run}`,
          price: 25000,
          duration: 60,
          categoryId: category.body.id,
        })
      ).body.id;
      clientId = (
        await as(http.post('/api/clients')).send({
          name: 'Eva',
          lastname: 'Push',
          phone: `31${Date.now().toString().slice(-8)}`,
        })
      ).body.id;
      const emp = await as(http.post('/api/auth/register/employee')).send({
        name: 'Lina',
        lastname: 'Push',
        email: employeeEmail,
        phone: `3${(Date.now() + 7).toString().slice(-9)}`,
        password: 'Secreta1!',
        services: [{ serviceId }],
      });
      expect(emp.status).toBe(201);
      employeeId = emp.body.user.id;
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true,
                notification_token = 'push-empleada' WHERE id = $1`,
        [employeeId],
      );
      const login = await http
        .post('/api/auth/login')
        .send({ email: employeeEmail, password: 'Secreta1!' });
      expect(login.status).toBe(200);
      employeeToken = login.body.token;
      monday = new Date(futureMonday(await firstFreeWeek(ds)))
        .toISOString()
        .slice(0, 10);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('PATCH /users/:id guarda el token, pero la respuesta no lo trae', async () => {
      const res = await as(http.patch(`/api/users/${ownerId}`)).send({
        notification_token: 'push-duena',
      });
      expect(res.status).toBe(200);
      expect(findKey(res.body)).toEqual([]);
      expect(await storedToken(ownerId)).toBe('push-duena');
      expect(await storedToken(employeeId)).toBe('push-empleada');
    });

    it('GET /users/:param (uno mismo, un empleado, por email) y GET /users: sin la clave', async () => {
      for (const url of [
        `/api/users/${ownerId}`,
        `/api/users/${employeeId}`,
        `/api/users/${encodeURIComponent(employeeEmail)}`,
        '/api/users',
      ]) {
        const res = await as(http.get(url));
        expect([url, res.status]).toEqual([url, 200]);
        expect([url, findKey(res.body)]).toEqual([url, []]);
      }
    });

    it('POST y PATCH /appointments: el profesional anidado no trae la clave', async () => {
      const created = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: employeeId,
        service_ids: [serviceId],
        date: `${monday}T10:00:00`,
      });
      expect(created.status).toBe(201);
      expect(created.body.professional?.id).toBe(employeeId);
      expect(findKey(created.body)).toEqual([]);
      appointmentId = created.body.id;

      const moved = await as(
        http.patch(`/api/appointments/${appointmentId}`),
      ).send({ date: `${monday}T11:00:00`, notes: 'Mover' });
      expect(moved.status).toBe(200);
      expect(findKey(moved.body)).toEqual([]);

      // La cita que se crea el Owner a sí mismo (su token también está guardado).
      const own = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: ownerId,
        service_ids: [serviceId],
        date: `${monday}T15:00:00`,
      });
      expect(own.status).toBe(201);
      expect(findKey(own.body)).toEqual([]);

      for (const url of [
        `/api/appointments/${appointmentId}`,
        `/api/appointments?startDate=${monday}&endDate=${monday}`,
      ]) {
        const res = await as(http.get(url));
        expect([url, findKey(res.body)]).toEqual([url, []]);
      }
    });

    it('la empleada crea su cita: tampoco recibe su propio token', async () => {
      const res = await as(http.post('/api/appointments'), employeeToken).send({
        client_id: clientId,
        professional_id: employeeId,
        service_ids: [serviceId],
        date: `${monday}T13:00:00`,
      });
      expect(res.status).toBe(201);
      expect(findKey(res.body)).toEqual([]);
    });

    it('/sync/changes (Owner y Employee): ni users ni appointments traen la clave', async () => {
      const ownerFeed = await pullAll(ownerToken);
      const entities = new Set(ownerFeed.map((c: any) => c.entity));
      expect(entities.has('users')).toBe(true);
      expect(entities.has('appointments')).toBe(true);
      expect(findKey(ownerFeed)).toEqual([]);

      const employeeFeed = await pullAll(employeeToken);
      expect(employeeFeed.length).toBeGreaterThan(0);
      expect(findKey(employeeFeed)).toEqual([]);
    });
  },
);
