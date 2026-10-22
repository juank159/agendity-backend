/**
 * Tarea 2.03: suscripción por el tenant real y lecturas que NO escriben.
 *
 * Solo lectura sobre la BD de desarrollo:
 * - Todas las escrituras de TypeORM están bloqueadas con espías (lanzan) y,
 *   además, se registra TODO el SQL que pasa por el driver: ninguna petición de
 *   lectura puede emitir INSERT/UPDATE/DELETE.
 * - Antes y después se compara la tabla `subscriptions` completa (incluido
 *   `updated_at`): debe quedar idéntica.
 * - Aislamiento: el Owner real y su Employee ven la suscripción del negocio; un
 *   tenant ajeno (sin fila) ve un trial sin usar que no se crea.
 */
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { User } from '../src/users/entities/user.entity';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

const STRANGER_ID = '44444444-4444-4444-8444-444444444444';

const WRITE_METHODS = {
  repository: [
    'save',
    'insert',
    'update',
    'upsert',
    'remove',
    'softRemove',
    'delete',
    'softDelete',
  ],
  manager: ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
} as const;

describe('Suscripciones por tenant (e2e, solo lectura)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User | null;
  let ownerToken: string;
  let employeeToken: string | null;
  let strangerToken: string;
  let ownerSubscription: Subscription | null;
  let writeSpies: jest.SpyInstance[];
  let sql: string[];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Toda la tabla, con `updated_at` exacto (texto de Postgres, sin pasar por Date). */
  const snapshot = () =>
    ds.query(
      `SELECT id, tenant_id, status, plan_id, trial_appointments_used,
              trial_appointments_limit, is_trial_used, subscription_end_date::text,
              updated_at::text AS updated_at
       FROM subscriptions ORDER BY id`,
    );

  const expectNoWrites = () => {
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
    const writes = sql.filter((q) =>
      /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(q),
    );
    expect(writes).toEqual([]);
  };

  beforeAll(async () => {
    let app;
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    ({ owner, employee } = await findDevOwnerAndEmployee(ds));
    if (
      await ds
        .getRepository(User)
        .exist({ where: { id: STRANGER_ID }, withDeleted: true })
    ) {
      throw new Error('STRANGER_ID existe en la BD: cambiarlo');
    }
    ownerToken = signToken(owner, ['Owner']);
    employeeToken = employee ? signToken(employee, ['Employee']) : null;
    strangerToken = signToken(
      { id: STRANGER_ID, name: 'Ajeno', email: 'ajeno-sub@e2e.local' },
      ['Owner'],
    );
    ownerSubscription = await ds.getRepository(Subscription).findOne({
      where: { tenant_id: owner.id },
      order: { created_at: 'DESC' },
    });
  }, 60000);

  beforeEach(() => {
    const blocked = () => {
      throw new Error('Escritura bloqueada en el e2e de suscripciones');
    };
    writeSpies = [
      ...WRITE_METHODS.repository.map((m) =>
        jest.spyOn(Repository.prototype, m as any).mockImplementation(blocked),
      ),
      ...WRITE_METHODS.manager.map((m) =>
        jest
          .spyOn(EntityManager.prototype, m as any)
          .mockImplementation(blocked),
      ),
    ];
    sql = [];
    const query = PostgresQueryRunner.prototype.query;
    jest
      .spyOn(PostgresQueryRunner.prototype, 'query')
      .mockImplementation(function (this: any, q: string, ...rest: any[]) {
        sql.push(q);
        return (query as any).call(this, q, ...rest);
      });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await close?.();
  });

  it('GET status y GET check-limits no escriben (espías + SQL + updated_at)', async () => {
    const before = await snapshot();
    const tokens = [ownerToken, strangerToken, employeeToken].filter(Boolean);

    for (const token of tokens) {
      for (let i = 0; i < 2; i++) {
        const status = await http
          .get('/api/subscriptions/status')
          .set(auth(token));
        expect(status.status).toBe(200);
        const limits = await http
          .get('/api/subscriptions/check-limits')
          .set(auth(token));
        expect(limits.status).toBe(200);
      }
    }

    expect(sql.some((q) => /"subscriptions"/.test(q))).toBe(true);
    expectNoWrites();
    expect(await snapshot()).toEqual(before);
    expect(
      await ds
        .getRepository(Subscription)
        .count({ where: { tenant_id: STRANGER_ID } }),
    ).toBe(0);
  });

  it('Owner real: ve la suscripción de SU negocio (tenant = su id)', async () => {
    const res = await http
      .get('/api/subscriptions/status')
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.tenant_id).toBe(owner.id);
    if (ownerSubscription) {
      expect(res.body.id).toBe(ownerSubscription.id);
      if (ownerSubscription.status === 'trial') {
        expect(res.body.status).toBe('trial');
        expect(res.body.trial_appointments_used).toBe(
          ownerSubscription.trial_appointments_used,
        );
      }
    } else {
      expect(res.body.id).toBeNull();
      expect(res.body.status).toBe('trial');
    }

    const limits = await http
      .get('/api/subscriptions/check-limits')
      .set(auth(ownerToken));
    expect(limits.status).toBe(200);
    if (ownerSubscription?.status === 'trial') {
      const left =
        ownerSubscription.trial_appointments_limit -
        ownerSubscription.trial_appointments_used;
      expect(limits.body).toEqual(
        left > 0
          ? {
              canCreateAppointment: true,
              message: `Citas restantes en prueba: ${left}`,
            }
          : expect.objectContaining({
              canCreateAppointment: false,
              code: 'TRIAL_LIMIT_REACHED',
            }),
      );
    }
    expectNoWrites();
  });

  it('Employee real: ve la misma suscripción que su Owner', async () => {
    if (!employeeToken) return;
    const [ownerRes, employeeRes] = [
      await http.get('/api/subscriptions/status').set(auth(ownerToken)),
      await http.get('/api/subscriptions/status').set(auth(employeeToken)),
    ];
    expect(employeeRes.status).toBe(200);
    expect(employeeRes.body.tenant_id).toBe(owner.id);
    expect(employeeRes.body.id).toBe(ownerRes.body.id);
    const limits = [
      await http.get('/api/subscriptions/check-limits').set(auth(ownerToken)),
      await http
        .get('/api/subscriptions/check-limits')
        .set(auth(employeeToken)),
    ];
    expect(limits[1].body).toEqual(limits[0].body);
    expectNoWrites();
  });

  it('tenant ajeno sin fila: trial sin usar, sin crear la fila ni ver datos de otro', async () => {
    const t = auth(strangerToken);
    const status = await http.get('/api/subscriptions/status').set(t);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({
      id: null,
      tenant_id: STRANGER_ID,
      status: 'trial',
      trial_appointments_used: 0,
      trial_appointments_limit: 20,
      plan: null,
      payments: [],
    });
    if (ownerSubscription) {
      expect(status.body.id).not.toBe(ownerSubscription.id);
    }

    const limits = await http.get('/api/subscriptions/check-limits').set(t);
    expect(limits.body).toEqual({
      canCreateAppointment: true,
      message: 'Citas restantes en prueba: 20',
    });

    const history = await http.get('/api/subscriptions/payment-history').set(t);
    expect(history.status).toBe(200);
    expect(history.body).toEqual([]);

    // Escrituras sin fila: no tocan la suscripción de nadie.
    const cancel = await http.post('/api/subscriptions/cancel').set(t);
    expect(cancel.status).toBe(404);
    const refresh = await http.post('/api/subscriptions/refresh-status').set(t);
    expect(refresh.status).toBe(200);
    expect(refresh.body.success).toBe(false);
    expectNoWrites();
  });

  it('suscripción activa vencida: se responde expired / SUBSCRIPTION_INACTIVE sin guardar expired', async () => {
    const overdue = await ds
      .createQueryBuilder(Subscription, 's')
      .where('s.status = :active', { active: 'active' })
      .andWhere('s.subscription_end_date < :now', { now: new Date() })
      .andWhere('s.plan_id IS NOT NULL')
      .getOne();
    if (!overdue) return; // la BD de desarrollo ya no tiene ninguna
    const before = await snapshot();

    // Token de un Owner cuyo tenant es el de esa fila (hoy, una fila huérfana).
    const token = signToken(
      { id: overdue.tenant_id, name: 'Vencida', email: 'vencida@e2e.local' },
      ['Owner'],
    );
    const status = await http.get('/api/subscriptions/status').set(auth(token));
    expect(status.status).toBe(200);
    expect(status.body.id).toBe(overdue.id);
    expect(status.body.status).toBe('expired');

    const limits = await http
      .get('/api/subscriptions/check-limits')
      .set(auth(token));
    expect(limits.body).toEqual({
      canCreateAppointment: false,
      code: 'SUBSCRIPTION_INACTIVE',
      message: 'Tu suscripción ha expirado. Por favor, renueva tu plan.',
    });
    expectNoWrites();
    expect(await snapshot()).toEqual(before);
  });

  it('subscribe, cancel y refresh-status son solo del Owner', async () => {
    if (!employeeToken) return;
    const t = auth(employeeToken);
    for (const path of ['subscribe', 'cancel', 'refresh-status']) {
      const res = await http.post(`/api/subscriptions/${path}`).set(t).send({});
      expect([path, res.status]).toEqual([path, 403]);
    }
    expectNoWrites();
  });
});
