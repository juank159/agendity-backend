/**
 * Tarea 2.08: bugs menores de rutas.
 *
 * - Bloque de solo lectura (corre siempre, contra la BD del `.env`): toda
 *   escritura de TypeORM está bloqueada con espías. Solo GET y POST que la
 *   validación corta antes del handler.
 * - Bloque que escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`):
 *   bloqueos de tiempo, horarios y servicios.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import {
  allowFictitiousAccounts,
  findDevOwnerAndEmployee,
  signToken,
} from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
  firstFreeWeek,
  futureMonday,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';

describe('Bugs menores 2.08 (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let ownerToken: string;
  let client: Client | null;
  let service: Service | null;
  const writes: string[] = [];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    ({ owner } = await findDevOwnerAndEmployee(ds));
    ownerToken = signToken(owner, ['Owner']);
    allowFictitiousAccounts(app, [ADMIN_ID]);
    client = await ds
      .getRepository(Client)
      .findOne({ where: { ownerId: owner.id } });
    service = await ds
      .getRepository(Service)
      .findOne({ where: { ownerId: owner.id } });
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    writes.length = 0;
    const block = (proto: object, methods: string[], label: string) =>
      methods.forEach((m) =>
        jest.spyOn(proto as any, m).mockImplementation(() => {
          writes.push(`${label}.${m}`);
          throw new Error(`Escritura bloqueada en un test de solo lectura`);
        }),
      );
    block(
      Repository.prototype,
      ['save', 'insert', 'update', 'upsert', 'remove', 'delete', 'softDelete'],
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

  afterAll(async () => close?.());

  it('GET /clients/no-uuid → 400 BAD_REQUEST (el error de BD llega al filtro global)', async () => {
    for (const method of ['get', 'patch', 'delete'] as const) {
      const res = await http[method]('/api/clients/no-uuid')
        .set(auth(ownerToken))
        .send(method === 'patch' ? { name: 'x' } : undefined);
      expect([method, res.status, res.body.code]).toEqual([
        method,
        400,
        'BAD_REQUEST',
      ]);
    }
  });

  it('GET /time-blocks/user/:id funciona sin fechas (son opcionales)', async () => {
    const res = await http
      .get(`/api/time-blocks/user/${owner.id}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const withDates = await http
      .get(
        `/api/time-blocks/user/${owner.id}?startDate=2000-01-01&endDate=2000-01-02`,
      )
      .set(auth(ownerToken));
    expect(withDates.status).toBe(200);

    const bad = await http
      .get(`/api/time-blocks/user/${owner.id}?startDate=nada`)
      .set(auth(ownerToken));
    expect(bad.status).toBe(400);
  });

  it('GET /appointments: startDate/endDate opcionales; inválida o invertida → 400 BAD_REQUEST (2.34)', async () => {
    const past = await http
      .get('/api/appointments?startDate=1980-01-01&endDate=1980-01-02')
      .set(auth(ownerToken));
    expect([past.status, past.body]).toEqual([200, []]);

    const bad = await http
      .get('/api/appointments?startDate=nada')
      .set(auth(ownerToken));
    expect([bad.status, bad.body.code]).toEqual([400, 'BAD_REQUEST']);

    const inverted = await http
      .get('/api/appointments?startDate=2030-01-03&endDate=2030-01-01')
      .set(auth(ownerToken));
    expect([inverted.status, inverted.body.code]).toEqual([400, 'BAD_REQUEST']);
  });

  it('POST /time-blocks valida las fechas como cadenas ISO (rango invertido → 400 de la regla, no del DTO)', async () => {
    const res = await http.post('/api/time-blocks').set(auth(ownerToken)).send({
      user_id: owner.id,
      start_datetime: '2010-01-04T10:00:00-05:00',
      end_datetime: '2010-01-04T09:00:00-05:00',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).not.toBe('VALIDATION_ERROR');

    const notADate = await http
      .post('/api/time-blocks')
      .set(auth(ownerToken))
      .send({
        user_id: owner.id,
        start_datetime: 'mañana',
        end_datetime: '2010-01-04T09:00:00-05:00',
      });
    expect(notADate.status).toBe(400);
    expect(notADate.body.code).toBe('VALIDATION_ERROR');
  });

  it('service_ids: lista vacía o con repetidos → 400 VALIDATION_ERROR (crear y editar)', async () => {
    const sid = service?.id ?? '55555555-5555-4555-8555-555555555555';
    const base = {
      client_id: client?.id ?? owner.id,
      professional_id: owner.id,
      date: '2100-01-04T10:00:00',
    };
    for (const service_ids of [[], [sid, sid]]) {
      const created = await http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({ ...base, service_ids });
      expect([service_ids.length, created.status, created.body.code]).toEqual([
        service_ids.length,
        400,
        'VALIDATION_ERROR',
      ]);
      const updated = await http
        .patch('/api/appointments/55555555-5555-4555-8555-555555555555')
        .set(auth(ownerToken))
        .send({ service_ids });
      expect([service_ids.length, updated.status, updated.body.code]).toEqual([
        service_ids.length,
        400,
        'VALIDATION_ERROR',
      ]);
    }
  });

  it('notificaciones huérfanas (receptor borrado): 404 para el Owner y la lista del Admin no rompe', async () => {
    const orphan = await ds
      .getRepository(Notification)
      .createQueryBuilder('n')
      .where(
        `n.receiver_type = 'CLIENT' AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = n.receiver_id)`,
      )
      .getOne();
    if (orphan) {
      const res = await http
        .get(`/api/notifications/${orphan.id}`)
        .set(auth(ownerToken));
      expect(res.status).toBe(404);
      const byReceiver = await http
        .get(`/api/notifications/receiver/${orphan.receiver_id}?type=CLIENT`)
        .set(auth(ownerToken));
      expect(byReceiver.status).toBe(404);
    }
    const admin = signToken(
      { id: ADMIN_ID, name: 'Admin', email: 'admin@test.local' },
      ['Admin'],
    );
    const list = await http.get('/api/notifications').set(auth(admin));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
  });
});

describeWritable(
  `Bugs menores 2.08 contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User | null;
    let ownerToken: string;
    let client: Client;
    let service: Service;
    let week = 0;

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      ({ owner, employee } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      service = await ds
        .getRepository(Service)
        .findOneOrFail({ where: { ownerId: owner.id, isActive: true } });
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      // Semanas propias a futuro (2.21), después de la última cita o bloqueo
      // de la copia (no chocan con corridas anteriores). `nextMonday` suma 1.
      week = (await firstFreeWeek(ds)) - 1;
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    /** Lunes 10:00 de Bogotá de una semana nueva (a futuro, 2.21). */
    function nextMonday(hour = 10): Date {
      week += 1;
      return new Date(futureMonday(week) + (hour + 5) * 3_600_000);
    }
    const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);

    const postBlock = (start: Date, end: Date, user_id = owner.id) =>
      http.post('/api/time-blocks').set(auth(ownerToken)).send({
        user_id,
        start_datetime: start.toISOString(),
        end_datetime: end.toISOString(),
        notes: 'e2e 2.08',
      });

    it('POST /time-blocks crea el bloqueo (201) y rechaza otro que se cruza', async () => {
      const start = nextMonday();
      const created = await postBlock(start, plus(start, 60));
      expect(created.status).toBe(201);
      expect(new Date(created.body.start_datetime).getTime()).toBe(
        start.getTime(),
      );

      const overlapping = await postBlock(plus(start, 30), plus(start, 90));
      expect(overlapping.status).toBe(400);

      // Contiguo [fin, fin+30) sí cabe.
      const adjacent = await postBlock(plus(start, 60), plus(start, 90));
      expect(adjacent.status).toBe(201);

      // Sin fechas devuelve los del profesional, con fechas los filtra.
      const all = await http
        .get(`/api/time-blocks/user/${owner.id}`)
        .set(auth(ownerToken));
      expect(all.body.map((b: { id: string }) => b.id)).toEqual(
        expect.arrayContaining([created.body.id, adjacent.body.id]),
      );
    });

    it('un bloqueo encima de una cita no cancelada → SLOT_UNAVAILABLE; sobre una cancelada sí se puede', async () => {
      const start = nextMonday();
      const appt = await http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: owner.id,
          service_ids: [service.id],
          date: start.toISOString(),
        });
      expect(appt.status).toBe(201);

      const over = await postBlock(plus(start, 10), plus(start, 20));
      expect([over.status, over.body.code]).toEqual([409, 'SLOT_UNAVAILABLE']);
      expect(over.body.message).toBe('Horario no disponible');

      // Mover un bloqueo existente encima de la cita también se rechaza.
      const later = await postBlock(plus(start, 300), plus(start, 330));
      expect(later.status).toBe(201);
      const moved = await http
        .patch(`/api/time-blocks/${later.body.id}`)
        .set(auth(ownerToken))
        .send({ start_datetime: plus(start, 5).toISOString() });
      expect([moved.status, moved.body.code]).toEqual([
        409,
        'SLOT_UNAVAILABLE',
      ]);

      const cancelled = await http
        .patch(`/api/appointments/${appt.body.id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      expect(cancelled.status).toBe(200);
      const free = await postBlock(plus(start, 10), plus(start, 20));
      expect(free.status).toBe(201);
    });

    it('POST /schedules crea el horario (201) y rechaza uno solapado; PATCH también valida', async () => {
      if (!employee) return;
      // Domingo (7): el empleado de dev no trabaja; se borra al final.
      const created = await http
        .post('/api/schedules')
        .set(auth(ownerToken))
        .send({
          user_id: employee.id,
          day_of_week: 7,
          start_time: '10:00',
          end_time: '12:00',
          is_available: true,
        });
      expect(created.status).toBe(201);
      try {
        const overlapping = await http
          .post('/api/schedules')
          .set(auth(ownerToken))
          .send({
            user_id: employee.id,
            day_of_week: 7,
            start_time: '11:00',
            end_time: '13:00',
            is_available: true,
          });
        expect(overlapping.status).toBe(400);

        const patched = await http
          .patch(`/api/schedules/${created.body.id}`)
          .set(auth(ownerToken))
          .send({ end_time: '12:30' });
        expect(patched.status).toBe(200);
      } finally {
        const removed = await http
          .delete(`/api/schedules/${created.body.id}`)
          .set(auth(ownerToken));
        expect(removed.status).toBe(200);
      }
    });

    it('GET /appointments filtra por [startDate, endDate); endDate solo fecha incluye el día; el Employee solo ve las suyas (2.34)', async () => {
      const morning = nextMonday(10);
      const afternoon = plus(morning, 5 * 60); // 15:00 del mismo día
      const ids: string[] = [];
      for (const date of [morning, afternoon]) {
        const res = await http
          .post('/api/appointments')
          .set(auth(ownerToken))
          .send({
            client_id: client.id,
            professional_id: owner.id,
            service_ids: [service.id],
            date: date.toISOString(),
          });
        expect(res.status).toBe(201);
        ids.push(res.body.id);
      }
      const list = async (query: string, token = ownerToken) => {
        const res = await http
          .get(`/api/appointments?${query}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        return res.body.map((a: { id: string }) => a.id);
      };

      // Fin exclusivo: la de las 15:00 queda fuera.
      expect(
        await list(
          `startDate=${encodeURIComponent(morning.toISOString())}&endDate=${encodeURIComponent(afternoon.toISOString())}`,
        ),
      ).toEqual([ids[0]]);
      // Solo fecha (día del negocio): las dos, en orden.
      const day = morning.toISOString().slice(0, 10);
      expect(await list(`startDate=${day}&endDate=${day}`)).toEqual(ids);
      // Solo inicio: desde las 15:00 (incluida).
      expect(
        await list(`startDate=${encodeURIComponent(afternoon.toISOString())}`),
      ).toContain(ids[1]);
      expect(
        await list(`startDate=${encodeURIComponent(afternoon.toISOString())}`),
      ).not.toContain(ids[0]);
      // Sin ningún extremo: todas las del alcance (como antes).
      expect(await list('')).toEqual(expect.arrayContaining(ids));
      // Employee: mismo rango, sin las citas de otro profesional.
      if (employee) {
        const employeeToken = signToken(employee, ['Employee']);
        expect(
          await list(`startDate=${day}&endDate=${day}`, employeeToken),
        ).toEqual([]);
      }
    });

    it('PATCH /services/:id sin categoryId guarda los cambios y no toca lo que no se envía', async () => {
      const before = await ds
        .getRepository(Service)
        .findOneByOrFail({ id: service.id });
      const newPrice = Number(before.price) + 1;
      const res = await http
        .patch(`/api/services/${service.id}`)
        .set(auth(ownerToken))
        .send({ price: newPrice });
      expect(res.status).toBe(200);
      const after = await ds
        .getRepository(Service)
        .findOneByOrFail({ id: service.id });
      expect(Number(after.price)).toBe(newPrice);
      expect(after.categoryId).toBe(before.categoryId);
      expect(after.onlineBooking).toBe(before.onlineBooking);
      expect(after.priceType).toBe(before.priceType);
      expect(Number(after.deposit)).toBe(Number(before.deposit));
    });

    it('nombre de servicio único por negocio: repetido en el mismo negocio → 409; en otro negocio se permite', async () => {
      const other = await ds
        .getRepository(Service)
        .findOneOrFail({ where: { ownerId: owner.id, isActive: true } });
      const dup = await http.post('/api/services').set(auth(ownerToken)).send({
        name: other.name.toUpperCase(),
        price: 1000,
        duration: 30,
        categoryId: other.categoryId,
      });
      expect(dup.status).toBe(409);

      // Renombrar otro servicio al mismo nombre también es 409.
      const siblings = await ds
        .getRepository(Service)
        .find({ where: { ownerId: owner.id } });
      const sibling = siblings.find((s) => s.id !== other.id);
      if (sibling) {
        const rename = await http
          .patch(`/api/services/${sibling.id}`)
          .set(auth(ownerToken))
          .send({ name: other.name });
        expect(rename.status).toBe(409);
      }

      // Mismo nombre bajo otro "dueño" (índice (owner_id, name)): se permite.
      if (employee) {
        await ds
          .transaction(async (manager) => {
            await manager.query(
              `INSERT INTO services (owner_id, name, price, duration, category_id, color)
             VALUES ($1, $2, 1, 30, $3, '#000000')`,
              [employee.id, other.name, other.categoryId],
            );
            const rows = await manager.query(
              'SELECT count(*)::int AS n FROM services WHERE name = $1',
              [other.name],
            );
            expect(rows[0].n).toBe(2);
            // Deshace la fila de prueba.
            throw new RollbackMarker();
          })
          .catch((error) => {
            if (!(error instanceof RollbackMarker)) throw error;
          });
      }
    });
  },
);

class RollbackMarker extends Error {}
