/**
 * Estadísticas de pagos (e2e, solo lectura sobre la BD de desarrollo).
 *
 * 2.26: las estadísticas no hacen consultas de diagnóstico (`information_schema`,
 * muestras de pagos, la misma suma dos veces, todos los pagos del negocio sin
 * filtro de fechas) ni escriben en la consola en cada llamada.
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
