/**
 * Tarea 2.05: fechas como instantes (`timestamptz`) y zona del negocio.
 *
 * Solo lectura sobre la BD de desarrollo (escrituras de TypeORM bloqueadas; la
 * prueba de ida y vuelta usa una tabla TEMPORARY de la sesión). Debe pasar con
 * el proceso en America/Bogota y con `TZ=UTC`.
 */
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PaymentStatsService } from '../src/payments/payment-stats.service';
import { User } from '../src/users/entities/user.entity';
import {
  parseBusinessDate,
  toBusinessIso,
} from '../src/common/utils/date.util';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

const BOGOTA = 'America/Bogota';

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Todas las cadenas con forma de fecha-hora ISO de un JSON. */
function isoStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string' && ISO_DATE_TIME.test(value)) found.push(value);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) isoStrings(v, found);
  }
  return found;
}

describe('Fechas y zona del negocio (e2e, 2.05)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;
  let app: any;
  let ds: DataSource;
  let owner: User;
  let ownerToken: string;

  const auth = () => ({ Authorization: `Bearer ${ownerToken}` });

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    ({ owner } = await findDevOwnerAndEmployee(ds));
    ownerToken = signToken(owner, ['Owner']);
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    const blocked = () => {
      throw new Error('Escritura bloqueada en el e2e de fechas');
    };
    for (const m of ['save', 'insert', 'update', 'remove', 'delete']) {
      jest.spyOn(Repository.prototype, m as any).mockImplementation(blocked);
      jest.spyOn(EntityManager.prototype, m as any).mockImplementation(blocked);
    }
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await close?.();
  });

  it('las respuestas salen en ISO con el offset del negocio (-05:00), nunca en Z', async () => {
    const res = await http.get('/api/categories').set(auth());
    expect(res.status).toBe(200);
    const dates = isoStrings(res.body);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      expect(d).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}-05:00$/);
    }
  });

  it('query sin offset = día del negocio; con offset se respeta', async () => {
    const stats = jest
      .spyOn(app.get(PaymentStatsService), 'getPaymentStats')
      .mockResolvedValue({
        total_amount: 0,
        payment_count: 0,
        average_amount: 0,
      });

    const naive = await http
      .get('/api/payments/stats?startDate=2026-10-21&endDate=2026-10-21')
      .set(auth());
    expect(naive.status).toBe(200);
    const [start, end] = stats.mock.calls[0];
    expect((start as Date).toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect((end as Date).toISOString()).toBe('2026-10-21T05:00:00.000Z');

    const withOffset = await http
      .get(
        '/api/payments/stats?startDate=2026-10-21T00:00:00Z&endDate=2026-10-21T08:00:00.000',
      )
      .set(auth());
    expect(withOffset.status).toBe(200);
    const [start2, end2] = stats.mock.calls[1];
    expect((start2 as Date).toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect((end2 as Date).toISOString()).toBe('2026-10-21T13:00:00.000Z');

    const bad = await http
      .get('/api/payments/stats?startDate=21/10/2026&endDate=2026-10-21')
      .set(auth());
    expect(bad.status).toBe(400);
    expect(stats).toHaveBeenCalledTimes(2);
  });

  it('cita a las 08:00 de Bogotá: Postgres guarda 13:00 UTC y se lee 08:00-05:00', async () => {
    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(
        'CREATE TEMPORARY TABLE tz_probe_205 (d timestamptz NOT NULL)',
      );
      // Lo que llega de la app hoy: hora local sin offset.
      const start = parseBusinessDate('2026-10-21T08:00:00.000', BOGOTA);
      await runner.query('INSERT INTO tz_probe_205 (d) VALUES ($1)', [start]);
      const [row] = await runner.query(
        `SELECT d, (d AT TIME ZONE 'UTC')::text AS utc,
                (d AT TIME ZONE 'America/Bogota')::text AS bogota
           FROM tz_probe_205`,
      );
      expect(row.utc).toBe('2026-10-21 13:00:00');
      expect(row.bogota).toBe('2026-10-21 08:00:00');
      expect(row.d).toBeInstanceOf(Date);
      expect(toBusinessIso(row.d, BOGOTA)).toBe(
        '2026-10-21T08:00:00.000-05:00',
      );
    } finally {
      await runner.query('DROP TABLE IF EXISTS tz_probe_205');
      await runner.release();
    }
  });
});
