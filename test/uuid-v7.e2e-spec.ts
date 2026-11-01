/**
 * Tarea 7.05a: el servidor acepta ids UUID de CUALQUIER versión (diseño de
 * sync §1). La app genera v7 sin conexión. Antes, un negocio que creaba
 * categorías desde la app no podía crear servicios en ellas (la categoría v7
 * se buscaba por nombre) y un servicio v7 no se podía agendar, ni consultar sus
 * horas libres, ni asignarse a una empleada nueva (`@IsUUID('4')`).
 *
 * Escribe: solo contra una copia (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`),
 * con un negocio nuevo (una sola alta de dueña).
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
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

/** UUID v7 (RFC 9562): 48 bits de milisegundos + versión 7 + variante 10. */
function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & BigInt(0xff));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describeWritable(
  'Ids UUID v7 de la app sin conexión (7.05a, e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    let ownerToken: string;
    let ownerId: string;
    let clientId: string;
    let day: string;

    const as = (req: any) => req.set(auth(ownerToken));
    const m = (type: string, entity_id: string, payload: object) => ({
      mutation_id: uuidv7(),
      type,
      entity_id,
      payload,
      client_time: new Date().toISOString(),
    });
    async function push(mutations: object[]) {
      const res = await as(http.post('/api/sync/push')).send({
        device_id: 'tablet-v7',
        mutations,
      });
      expect(res.status).toBe(200);
      return res.body.results as any[];
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Siete',
        email: `v7-${run}@example.com`,
        phone: `3${(Date.now() + 7).toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      expect(reg.status).toBe(201);
      ownerToken = reg.body.token;
      ownerId = reg.body.user.id;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const client = await as(http.post('/api/clients')).send({
        name: 'Ana',
        lastname: 'Siete',
        phone: `3${(Date.now() % 1e9).toString().padStart(9, '0')}`,
      });
      expect(client.status).toBe(201);
      clientId = client.body.id;
      day = new Date(futureMonday(await firstFreeWeek(ds)))
        .toISOString()
        .slice(0, 10);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('REST: categoría v7 → servicio en ella → se lee y edita por su id v7', async () => {
      const categoryId = uuidv7();
      const category = await as(http.post('/api/categories')).send({
        id: categoryId,
        name: `Uñas ${run}`,
      });
      expect(category.status).toBe(201);
      expect(category.body.id).toBe(categoryId);

      // GET /categories/:term con un v7 busca por id, no por nombre.
      const byId = await as(http.get(`/api/categories/${categoryId}`));
      expect(byId.status).toBe(200);
      expect(byId.body.id).toBe(categoryId);

      const serviceId = uuidv7();
      const service = await as(http.post('/api/services')).send({
        id: serviceId,
        name: `Manicure ${run}`,
        price: 25000,
        duration: 30,
        categoryId,
      });
      expect(service.status).toBe(201);
      expect(service.body.id).toBe(serviceId);

      expect(
        (await as(http.get(`/api/services/category/${categoryId}`))).status,
      ).toBe(200);
      const patch = await as(http.patch(`/api/services/${serviceId}`)).send({
        categoryId,
        price: 26000,
      });
      expect(patch.status).toBe(200);
      expect(
        (
          await as(http.patch(`/api/categories/${categoryId}`)).send({
            name: `Uñas bis ${run}`,
          })
        ).status,
      ).toBe(200);
    });

    it('/sync/push: categoría v7 y servicio con ese categoryId → applied (antes conflict NOT_FOUND)', async () => {
      const categoryId = uuidv7();
      const serviceId = uuidv7();
      const results = await push([
        m('category.create', categoryId, { name: `Cejas ${run}` }),
        m('service.create', serviceId, {
          name: `Diseño ${run}`,
          price: 30000,
          duration: 60,
          categoryId,
        }),
      ]);
      expect(results.map((r) => [r.status, r.code])).toEqual([
        ['applied', undefined],
        ['applied', undefined],
      ]);
      const [row] = await ds.query(
        'SELECT category_id AS category FROM services WHERE id = $1',
        [serviceId],
      );
      expect(row.category).toBe(categoryId);
    });

    it('servicio v7: horas libres, cita por REST y por /sync/push, y empleada nueva con él', async () => {
      const categoryId = uuidv7();
      const serviceId = uuidv7();
      const created = await push([
        m('category.create', categoryId, { name: `Pelo ${run}` }),
        m('service.create', serviceId, {
          name: `Corte ${run}`,
          price: 40000,
          duration: 30,
          categoryId,
        }),
      ]);
      expect(created.map((r) => r.status)).toEqual(['applied', 'applied']);

      // Horas libres de la dueña (sin horario propio) con el servicio v7.
      const slots = await as(
        http.get(
          `/api/appointments/available-slots?professional_id=${ownerId}` +
            `&date=${day}&service_ids=${serviceId}&step=30`,
        ),
      );
      expect(slots.status).toBe(200);

      // Cita por REST con id v7 y servicio v7.
      const appointmentId = uuidv7();
      const rest = await as(http.post('/api/appointments')).send({
        id: appointmentId,
        client_id: clientId,
        professional_id: ownerId,
        service_ids: [serviceId],
        date: `${day}T10:00:00`,
      });
      expect([rest.status, rest.body.code]).toEqual([201, undefined]);
      expect(rest.body.id).toBe(appointmentId);
      expect(
        (await as(http.get(`/api/appointments/${appointmentId}`))).status,
      ).toBe(200);

      // Cita por /sync/push con id v7 y servicio v7.
      const pushedId = uuidv7();
      const [pushed] = await push([
        m('appointment.create', pushedId, {
          client_id: clientId,
          professional_id: ownerId,
          service_ids: [serviceId],
          date: `${day}T11:00:00`,
        }),
      ]);
      expect([pushed.status, pushed.code]).toEqual(['applied', undefined]);

      // Empleada nueva con el servicio v7 (serviceIds y services).
      const employee = await as(http.post('/api/auth/register/employee')).send({
        name: 'Laura',
        lastname: 'Siete',
        email: `v7-emp-${run}@example.com`,
        phone: `3${(Date.now() + 77).toString().slice(-9)}`,
        password: 'Secreta1!',
        serviceIds: [serviceId],
        services: [{ serviceId }],
      });
      expect([employee.status, employee.body.code]).toEqual([201, undefined]);
      const [assigned] = await ds.query(
        'SELECT count(*)::int AS n FROM user_services WHERE user_id = $1 AND service_id = $2',
        [employee.body.user.id, serviceId],
      );
      expect(assigned.n).toBe(1);
    });
  },
);
