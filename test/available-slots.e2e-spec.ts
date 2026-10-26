/**
 * Tarea 2.14: `GET /appointments/available-slots` (huecos libres).
 *
 * - Bloque de solo lectura (corre siempre, contra la BD del `.env`): toda
 *   escritura de TypeORM está bloqueada con espías. Contrato, validación y
 *   alcance (Employee solo su agenda).
 * - Bloque que escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`):
 *   lo que lista coincide con lo que `POST /appointments` acepta o rechaza.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { toBusinessIso } from '../src/common/utils/date.util';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
  firstFreeWeek,
  futureMonday,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-05:00$/;
/** Lunes lejano sin citas en la BD de desarrollo. */
const FAR_MONDAY = '2099-01-05';
/** `…T09:30:00.000-05:00` → `09:30`. */
const hhmm = (iso: string) => iso.slice(11, 16);
/** Inicios cada `step` minutos entre `from` (incluido) y `to` (excluido), `HH:mm`. */
function grid(from: string, to: string, step = 30): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out: string[] = [];
  for (let m = toMin(from); m < toMin(to); m += step) {
    out.push(
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    );
  }
  return out;
}

async function devService30(ds: DataSource, ownerId: string): Promise<Service> {
  return ds.getRepository(Service).findOneOrFail({
    where: { ownerId, isActive: true, duration: 30 },
    order: { name: 'ASC' },
  });
}

describe('Huecos libres 2.14 (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User;
  let ownerToken: string;
  let employeeToken: string;
  let service: Service;
  const writes: string[] = [];

  const slotsUrl = (professionalId: string, extra = '') =>
    `/api/appointments/available-slots?professional_id=${professionalId}` +
    `&date=${FAR_MONDAY}&service_ids=${service.id}&step=30${extra}`;

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    const dev = await findDevOwnerAndEmployee(ds);
    owner = dev.owner;
    if (!dev.employee) throw new Error('La BD de dev no tiene empleado');
    employee = dev.employee;
    ownerToken = signToken(owner, ['Owner']);
    employeeToken = signToken(employee, ['Employee']);
    service = await devService30(ds, owner.id);
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

  it('Owner → empleado con horario L-V 09-18: inicios ISO con offset dentro del horario', async () => {
    const res = await http.get(slotsUrl(employee.id)).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((iso: string) => expect(iso).toMatch(ISO_WITH_OFFSET));
    expect(res.body.map(hhmm)).toEqual(grid('09:00', '18:00'));
  });

  it('profesional sin horario (el Owner de dev): todo el día del negocio', async () => {
    const res = await http.get(slotsUrl(owner.id)).set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.map(hhmm)).toEqual(grid('00:00', '24:00'));
    expect(res.body[0]).toBe(`${FAR_MONDAY}T00:00:00.000-05:00`);
  });

  it('Employee: su agenda sí; la de otro profesional → 403 FORBIDDEN', async () => {
    const own = await http.get(slotsUrl(employee.id)).set(auth(employeeToken));
    expect(own.status).toBe(200);
    const other = await http.get(slotsUrl(owner.id)).set(auth(employeeToken));
    expect([other.status, other.body.code]).toEqual([403, 'FORBIDDEN']);
  });

  it('service_ids repetido en la query o separado por comas: mismo resultado (duración sumada)', async () => {
    const other = await ds.getRepository(Service).findOneOrFail({
      where: { ownerId: owner.id, isActive: true, duration: 30 },
      order: { name: 'DESC' },
    });
    const base =
      `/api/appointments/available-slots?professional_id=${employee.id}` +
      `&date=${FAR_MONDAY}&step=60`;
    const a = await http
      .get(`${base}&service_ids=${service.id}&service_ids=${other.id}`)
      .set(auth(ownerToken));
    const b = await http
      .get(`${base}&service_ids=${service.id},${other.id}`)
      .set(auth(ownerToken));
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    if (other.id !== service.id) {
      // 60 min: el último inicio que cabe antes de las 18:00 es 17:00.
      expect(a.body.map(hhmm)).toEqual(grid('09:00', '18:00', 60));
    }
  });

  it.each([
    ['sin service_ids', `&date=${FAR_MONDAY}`],
    ['sin date', `&service_ids=SERVICE`],
    ['fecha imposible', `&date=2099-02-31&service_ids=SERVICE`],
    ['fecha con hora', `&date=${FAR_MONDAY}T10:00&service_ids=SERVICE`],
    [
      'paso demasiado pequeño',
      `&date=${FAR_MONDAY}&service_ids=SERVICE&step=1`,
    ],
    ['servicio no uuid', `&date=${FAR_MONDAY}&service_ids=abc`],
    [
      'servicio repetido',
      `&date=${FAR_MONDAY}&service_ids=SERVICE&service_ids=SERVICE`,
    ],
  ])('%s → 400 VALIDATION_ERROR', async (_label, extra) => {
    const res = await http
      .get(
        `/api/appointments/available-slots?professional_id=${employee.id}` +
          extra.replace(/SERVICE/g, service.id),
      )
      .set(auth(ownerToken));
    expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('hoy: no ofrece horas pasadas (2.21)', async () => {
    const now = Date.now();
    const today = toBusinessIso(new Date(now)).slice(0, 10);
    const res = await http
      .get(
        `/api/appointments/available-slots?professional_id=${owner.id}` +
          `&date=${today}&service_ids=${service.id}&step=30`,
      )
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(
      res.body.filter((iso: string) => new Date(iso).getTime() < now),
    ).toEqual([]);
  });

  it('crear una cita en una hora pasada → 400 APPOINTMENT_IN_PAST sin escribir (2.21)', async () => {
    const client = await ds
      .getRepository(Client)
      .findOneOrFail({ where: { ownerId: owner.id } });
    const res = await http
      .post('/api/appointments')
      .set(auth(ownerToken))
      .send({
        client_id: client.id,
        professional_id: employee.id,
        service_ids: [service.id],
        date: new Date(Date.now() - 3_600_000).toISOString(),
      });
    expect([res.status, res.body.code]).toEqual([400, 'APPOINTMENT_IN_PAST']);
  });

  it('servicio inexistente o de otro negocio → 404', async () => {
    const res = await http
      .get(
        `/api/appointments/available-slots?professional_id=${employee.id}` +
          `&date=${FAR_MONDAY}&service_ids=33333333-3333-4333-8333-333333333333`,
      )
      .set(auth(ownerToken));
    expect(res.status).toBe(404);
  });
});

describeWritable(
  `Huecos libres 2.14 contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User;
    let ownerToken: string;
    let employeeToken: string;
    let client: Client;
    let service: Service;
    let day: string;

    const at = (time: string) => `${day}T${time}:00-05:00`;
    const listSlots = async (token = ownerToken) => {
      const res = await http
        .get(
          `/api/appointments/available-slots?professional_id=${employee.id}` +
            `&date=${day}&service_ids=${service.id}&step=30`,
        )
        .set(auth(token));
      expect(res.status).toBe(200);
      return (res.body as string[]).map(hhmm);
    };
    const book = (time: string) =>
      http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: employee.id,
          service_ids: [service.id],
          date: at(time),
        });

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const dev = await findDevOwnerAndEmployee(ds);
      owner = dev.owner;
      employee = dev.employee as User;
      ownerToken = signToken(owner, ['Owner']);
      employeeToken = signToken(employee, ['Employee']);
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      service = await devService30(ds, owner.id);
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      // Un lunes propio a futuro (2.21), después de la última cita o bloqueo
      // de la copia (no choca con corridas anteriores).
      const week = await firstFreeWeek(ds);
      day = new Date(futureMonday(week)).toISOString().slice(0, 10);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('lo que lista coincide con lo que POST /appointments acepta o rechaza', async () => {
      expect(await listSlots()).toEqual(grid('09:00', '18:00'));

      const first = await book('10:00');
      expect(first.status).toBe(201);
      const afterBooking = await listSlots();
      expect(afterBooking).not.toContain('10:00');
      expect(afterBooking).toContain('09:30'); // termina justo a las 10:00
      expect(afterBooking).toContain('10:30'); // empieza justo al terminar

      // Cada candidato no listado del día (de 07:00 a 19:00) se rechaza al agendar.
      for (const time of grid('07:00', '19:00')) {
        if (afterBooking.includes(time)) continue;
        const res = await book(time);
        expect([time, res.status, res.body.code]).toEqual([
          time,
          400,
          'SLOT_UNAVAILABLE',
        ]);
      }
      // Y uno listado se acepta (y deja de listarse).
      const second = await book('10:30');
      expect(second.status).toBe(201);
      expect(await listSlots()).not.toContain('10:30');

      // Cancelar libera el hueco.
      const cancel = await http
        .patch(`/api/appointments/${first.body.id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      expect(cancel.status).toBe(200);
      expect(await listSlots()).toContain('10:00');
    });

    it('un bloqueo de tiempo ocupa su rango [inicio, fin) y el Employee ve lo mismo', async () => {
      const block = await http
        .post('/api/time-blocks')
        .set(auth(ownerToken))
        .send({
          user_id: employee.id,
          start_datetime: at('15:00'),
          end_datetime: at('16:00'),
        });
      expect(block.status).toBe(201);
      const slots = await listSlots();
      expect(slots).not.toContain('15:00');
      expect(slots).not.toContain('15:30');
      expect(slots).toContain('14:30');
      expect(slots).toContain('16:00');
      expect(await listSlots(employeeToken)).toEqual(slots);
      const res = await book('15:30');
      expect([res.status, res.body.code]).toEqual([400, 'SLOT_UNAVAILABLE']);
    });
  },
);
