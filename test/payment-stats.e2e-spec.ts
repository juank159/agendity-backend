/**
 * Estadísticas de pagos (e2e, solo lectura sobre la BD de desarrollo).
 *
 * 2.26: las estadísticas no hacen consultas de diagnóstico (`information_schema`,
 * muestras de pagos, la misma suma dos veces, todos los pagos del negocio sin
 * filtro de fechas) ni escriben en la consola en cada llamada.
 * 2.28 (bloque que escribe, solo en una copia): por servicio = ingreso neto
 * real repartido entre los servicios de la cita (una vez por cita, no por
 * pago); por método incluye los métodos propios y suma 100 %; la evolución
 * diaria separa pagos y citas.
 */
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { User } from '../src/users/entities/user.entity';
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
  firstFreeWeek,
  futureMonday,
  resetTrialQuota,
} from './utils/writable-db';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';

const RANGE = 'startDate=2026-01-01&endDate=2026-12-31';

describe('Estadísticas de pagos (e2e, solo lectura)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;
  let app: any;
  let owner: User;
  let ownerToken: string;
  let sql: string[];
  let consoleCalls: unknown[][];

  const auth = () => ({ Authorization: `Bearer ${ownerToken}` });
  /** SQL que toca la tabla de pagos (el resto es el JWT, roles, etc.). */
  const paymentSql = () => sql.filter((q) => /\bpayments\b/i.test(q));

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ({ owner } = await findDevOwnerAndEmployee(app.get(DataSource)));
    ownerToken = signToken(owner, ['Owner']);
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    const blocked = () => {
      throw new Error('Escritura bloqueada en el e2e de estadísticas');
    };
    for (const m of ['save', 'insert', 'update', 'remove', 'delete']) {
      jest.spyOn(Repository.prototype, m as any).mockImplementation(blocked);
      jest.spyOn(EntityManager.prototype, m as any).mockImplementation(blocked);
    }
    sql = [];
    const query = PostgresQueryRunner.prototype.query;
    jest
      .spyOn(PostgresQueryRunner.prototype, 'query')
      .mockImplementation(function (this: any, q: string, ...rest: any[]) {
        sql.push(q);
        return (query as any).call(this, q, ...rest);
      });
    consoleCalls = [];
    for (const m of ['log', 'info', 'debug', 'error', 'warn'] as const) {
      jest
        .spyOn(console, m)
        .mockImplementation((...args) => void consoleCalls.push(args));
    }
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await close?.();
  });

  const routes = () => [
    `/api/payments/stats?${RANGE}`,
    `/api/payments/employee-stats?${RANGE}&professionalId=${owner.id}`,
    `/api/payments/stats/by-method?${RANGE}`,
    `/api/payments/stats/comparison?${RANGE}`,
    `/api/payments/stats/by-service?${RANGE}`,
    `/api/payments/stats/by-professional?${RANGE}`,
    `/api/payments/stats/by-client?${RANGE}`,
    `/api/payments/stats/top-clients?${RANGE}`,
  ];

  it('ninguna estadística escribe en la consola ni consulta information_schema (2.26)', async () => {
    for (const url of routes()) {
      sql = [];
      consoleCalls = [];
      const res = await http.get(url).set(auth());
      expect([url, res.status]).toEqual([url, 200]);
      expect([url, consoleCalls]).toEqual([url, []]);
      expect(sql.filter((q) => /information_schema/i.test(q))).toEqual([]);
      // Toda consulta a pagos va acotada al periodo (nada de "todos los pagos").
      for (const q of paymentSql()) {
        expect([url, /created_at.*BETWEEN/is.test(q)]).toEqual([url, true]);
      }
    }
  });

  it('employee-stats: resumen, desglose por servicio y evolución diaria = 3 consultas (2.26)', async () => {
    const res = await http
      .get(`/api/payments/employee-stats?${RANGE}&professionalId=${owner.id}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'by_service',
      'daily_evolution',
      'summary',
    ]);
    expect(paymentSql()).toHaveLength(3);
  });

  it('stats: una sola consulta agregada, sin cargar los pagos (2.26)', async () => {
    const res = await http.get(`/api/payments/stats?${RANGE}`).set(auth());
    expect(res.status).toBe(200);
    expect(paymentSql()).toHaveLength(1);
    expect(paymentSql()[0]).toMatch(/SUM\(/);
  });
});

describeWritable(
  `Estadísticas de pagos contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let http: E2EHttp;
    let close: () => Promise<void>;
    let app: any;
    let ds: DataSource;
    let owner: User;
    let token: string;
    let client: Client;
    let cheap: Service;
    let pricey: Service;
    let week: number;

    const auth = () => ({ Authorization: `Bearer ${token}` });
    const day = new Date();
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.BUSINESS_TIMEZONE || 'America/Bogota',
    }).format(day);
    const range = `startDate=${ymd}&endDate=${ymd}`;

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      ({ owner } = await findDevOwnerAndEmployee(ds));
      token = signToken(owner, ['Owner']);
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      const services = await ds.getRepository(Service).find({
        where: { ownerId: owner.id, isActive: true },
        order: { price: 'ASC' },
      });
      cheap = services[0];
      pricey = services[services.length - 1];
      expect(Number(cheap.price)).toBeLessThan(Number(pricey.price));
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      week = await firstFreeWeek(ds);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => close?.());

    async function newAppointment(): Promise<{ id: string; total: number }> {
      week += 1;
      const res = await http
        .post('/api/appointments')
        .set(auth())
        .send({
          client_id: client.id,
          professional_id: owner.id,
          service_ids: [cheap.id, pricey.id],
          date: new Date(futureMonday(week) + 15 * 3_600_000).toISOString(),
        });
      expect(res.status).toBe(201);
      return { id: res.body.id, total: Number(res.body.total_price) };
    }

    const pay = async (appointmentId: string, amount: number, extra = {}) => {
      const res = await http
        .post('/api/payments')
        .set(auth())
        .send({
          appointment_id: appointmentId,
          amount,
          payment_method: 'CASH',
          ...extra,
        });
      expect(res.status).toBe(201);
      return res.body;
    };

    const get = async (path: string) => {
      const res = await http.get(`/api/payments/${path}`).set(auth());
      expect(res.status).toBe(200);
      return res.body;
    };
    const byServiceId = (rows: any[], id: string) =>
      rows.find((r) => r.service_id === id) ?? {
        total_amount: 0,
        appointment_count: 0,
        total: 0,
        count: 0,
      };

    it('by-service: ingreso neto repartido por precio, una vez por cita aunque tenga varios pagos; suma 100 % (2.28)', async () => {
      const before = await get(`stats/by-service?${range}`);
      const beforeEmployee = await get(
        `employee-stats?${range}&professionalId=${owner.id}`,
      );

      const { id, total } = await newAppointment();
      const first = Math.round(total * 40) / 100;
      const rest = Math.round((total - first) * 100) / 100;
      await pay(id, first);
      const second = await pay(id, rest);
      const refund = Math.round(total * 10) / 100;
      const refunded = await http
        .post(`/api/payments/${second.id}/refund`)
        .set(auth())
        .send({ refund_amount: refund, refund_reason: 'descuento' });
      expect(refunded.status).toBe(201);
      const net = total - refund;
      const share = Number(cheap.price) / total;

      const after = await get(`stats/by-service?${range}`);
      const delta = (svc: Service) =>
        byServiceId(after, svc.id).total_amount -
        byServiceId(before, svc.id).total_amount;
      expect(delta(cheap)).toBeCloseTo(net * share, 1);
      expect(delta(pricey)).toBeCloseTo(net * (1 - share), 1);
      for (const svc of [cheap, pricey]) {
        expect(
          byServiceId(after, svc.id).appointment_count -
            byServiceId(before, svc.id).appointment_count,
        ).toBe(1);
      }
      const percent = after.reduce(
        (sum: number, r: any) => sum + r.percentage_of_total,
        0,
      );
      expect(percent).toBeCloseTo(100, 1);
      const overview = await get(`stats?${range}`);
      expect(
        after.reduce((sum: number, r: any) => sum + r.total_amount, 0),
      ).toBeCloseTo(overview.total_amount, 1);

      // employee-stats.by_service: misma regla (count = citas).
      const employee = await get(
        `employee-stats?${range}&professionalId=${owner.id}`,
      );
      const eDelta = (svc: Service) =>
        byServiceId(employee.by_service, svc.id).total -
        byServiceId(beforeEmployee.by_service, svc.id).total;
      expect(eDelta(cheap)).toBeCloseTo(net * share, 1);
      expect(
        byServiceId(employee.by_service, pricey.id).count -
          byServiceId(beforeEmployee.by_service, pricey.id).count,
      ).toBe(1);

      // daily_evolution: hoy, 2 pagos más pero 1 cita más.
      const today = (body: any) =>
        body.daily_evolution.find((d: any) => d.date === ymd) ?? {
          count: 0,
          payment_count: 0,
          appointment_count: 0,
          total: 0,
        };
      expect(
        today(employee).payment_count - today(beforeEmployee).payment_count,
      ).toBe(2);
      expect(today(employee).count - today(beforeEmployee).count).toBe(2);
      expect(
        today(employee).appointment_count -
          today(beforeEmployee).appointment_count,
      ).toBe(1);
      expect(today(employee).total - today(beforeEmployee).total).toBeCloseTo(
        net,
        1,
      );
    });

    it('by-method: incluye los métodos propios (con su nombre) y los porcentajes suman 100 (2.28)', async () => {
      const name = `Nequi e2e ${Date.now()}`;
      const custom = await http
        .post('/api/custom-payment-methods')
        .set(auth())
        .send({ name });
      expect(custom.status).toBe(201);

      const { id, total } = await newAppointment();
      const half = Math.round(total * 50) / 100;
      await pay(id, half);
      await pay(id, Math.round((total - half) * 100) / 100, {
        payment_method: undefined,
        custom_payment_method_id: custom.body.id,
      });

      const rows = await get(`stats/by-method?${range}`);
      const own = rows.find(
        (r: any) => r.custom_payment_method_id === custom.body.id,
      );
      expect(own).toMatchObject({
        method: name,
        method_type: 'CUSTOM',
        count: 1,
      });
      expect(own.total).toBeCloseTo(total - half, 1);
      const percent = rows.reduce(
        (sum: number, r: any) => sum + r.percentage,
        0,
      );
      expect(percent).toBeCloseTo(100, 1);
      const overview = await get(`stats?${range}`);
      expect(
        rows.reduce((sum: number, r: any) => sum + r.total, 0),
      ).toBeCloseTo(overview.total_amount, 1);
      for (const r of rows.filter((r: any) => r.method_type === 'STANDARD')) {
        expect(r.custom_payment_method_id).toBeNull();
      }
    });

    it('el precio de cada servicio queda guardado en la cita: subir el precio del catálogo no cambia el total, ni al editar, ni el reparto por servicio (2.29)', async () => {
      const [{ id: categoryId }] = await ds.query(
        `SELECT id FROM categories WHERE owner_id = $1 LIMIT 1`,
        [owner.id],
      );
      const stamp = Date.now();
      const newService = async (name: string) => {
        const res = await http
          .post('/api/services')
          .set(auth())
          .send({ name, price: 10000, duration: 30, categoryId });
        expect(res.status).toBe(201);
        return res.body.id as string;
      };
      const a = await newService(`Corte e2e 2.29 ${stamp}`);
      const b = await newService(`Barba e2e 2.29 ${stamp}`);
      const before = await get(`stats/by-service?${range}`);

      week += 1;
      const created = await http
        .post('/api/appointments')
        .set(auth())
        .send({
          client_id: client.id,
          professional_id: owner.id,
          service_ids: [a, b],
          date: new Date(futureMonday(week) + 15 * 3_600_000).toISOString(),
        });
      expect(created.status).toBe(201);
      expect(Number(created.body.total_price)).toBe(20000);
      const id = created.body.id;
      await pay(id, 20000);

      // El servicio A sube de 10.000 a 30.000 en el catálogo.
      const raised = await http
        .patch(`/api/services/${a}`)
        .set(auth())
        .send({ price: 30000 });
      expect(raised.status).toBe(200);

      const read = await http.get(`/api/appointments/${id}`).set(auth());
      expect(Number(read.body.total_price)).toBe(20000);
      expect(
        read.body.services
          .map((s: any) => [s.id, s.appointment_price, Number(s.price)])
          .sort(),
      ).toEqual(
        [
          [a, '10000.00', 30000],
          [b, '10000.00', 10000],
        ].sort(),
      );
      expect(read.body).not.toHaveProperty('serviceLines');

      // Editar reenviando los mismos servicios (lo hace la app) no recalcula.
      const edited = await http
        .patch(`/api/appointments/${id}`)
        .set(auth())
        .send({ service_ids: [a, b], notes: 'editada 2.29' });
      expect(edited.status).toBe(200);
      expect(Number(edited.body.total_price)).toBe(20000);

      // Reparto por servicio con el precio guardado: 10.000 y 10.000 (no 15.000/5.000).
      const after = await get(`stats/by-service?${range}`);
      for (const svc of [a, b]) {
        expect(
          byServiceId(after, svc).total_amount -
            byServiceId(before, svc).total_amount,
        ).toBeCloseTo(10000, 1);
      }

      // La lista de citas también trae `services` con su precio en la cita.
      const list = await http.get('/api/appointments').set(auth());
      const listed = list.body.find((x: any) => x.id === id);
      expect(listed.services).toHaveLength(2);
      expect(listed.services.every((s: any) => s.appointment_price)).toBe(true);
    });
  },
);
