/**
 * Tarea 2.07: webhook de Wompi según la especificación (checksum de
 * `signature.properties` + `timestamp` + secreto de eventos, SHA256),
 * idempotente por `transaction.id` y con validación de importe y moneda.
 *
 * El secreto de eventos de la instancia se sustituye por uno de prueba: el
 * test nunca lee ni usa el del `.env`.
 *
 * 1. Solo lectura (corrida normal): firma inválida → 401, cuerpo malformado →
 *    400, evento válido sin intento → 200 sin ninguna escritura.
 * 2. Escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`): APPROVED dos
 *    veces → un solo efecto; importe distinto → no activa; la misma aprobación
 *    a la vez → una sola activación; DECLINED y PENDING.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';
import { PaymentHistory } from '../src/subscriptions/entities/payment-history.entity';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { SubscriptionPlan } from '../src/subscriptions/entities/subscription-plan.entity';
import { SubscriptionsService } from '../src/subscriptions/services/subscriptions.service';
import { WompiService } from '../src/subscriptions/services/wompi.service';
import { toCents } from '../src/payments/payment-rules';
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
  resetTrialQuota,
} from './utils/writable-db';

const TEST_EVENTS_SECRET = 'test_events_e2e_2_07';
const WEBHOOK = '/api/webhooks/wompi';

interface TxFields {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  reference: string;
}

/** Evento firmado como lo firma Wompi (propiedades en el orden indicado). */
function signedEvent(
  tx: Partial<TxFields> & Record<string, unknown>,
  {
    properties = [
      'transaction.id',
      'transaction.status',
      'transaction.amount_in_cents',
    ],
    timestamp = Math.floor(Date.now() / 1000),
    secret = TEST_EVENTS_SECRET,
  }: { properties?: string[]; timestamp?: number; secret?: string } = {},
) {
  const data = { transaction: tx };
  const values = properties
    .map((p) =>
      p.split('.').reduce<any>((node, key) => node?.[key], data as any),
    )
    .join('');
  const checksum = createHash('sha256')
    .update(`${values}${timestamp}${secret}`)
    .digest('hex');
  return {
    event: 'transaction.updated',
    data,
    environment: 'test',
    signature: { properties, checksum },
    timestamp,
    sent_at: new Date().toISOString(),
  };
}

async function startApp() {
  const started = await createE2EApp();
  // Secreto de prueba en la instancia (no el del .env).
  (started.app.get(WompiService) as any).eventIntegritySecret =
    TEST_EVENTS_SECRET;
  return started;
}

const WRITE_METHODS = {
  repository: ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
  manager: ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
} as const;

describe('Webhook de Wompi (e2e, solo lectura)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;
  let sql: string[];
  let writeSpies: jest.SpyInstance[];

  const expectNoWrites = () => {
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
    expect(sql.filter((q) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(q))).toEqual(
      [],
    );
  };

  beforeAll(async () => {
    ({ http, close } = await startApp());
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    sql = [];
    const original = PostgresQueryRunner.prototype.query;
    jest
      .spyOn(PostgresQueryRunner.prototype, 'query')
      .mockImplementation(function (this: any, query: string, ...rest: any[]) {
        sql.push(query);
        return original.call(this, query, ...rest);
      });
    const block = () => {
      throw new Error('Escritura bloqueada en un test de solo lectura');
    };
    writeSpies = [
      ...WRITE_METHODS.repository.map((m) =>
        jest.spyOn(Repository.prototype, m as any).mockImplementation(block),
      ),
      ...WRITE_METHODS.manager.map((m) =>
        jest.spyOn(EntityManager.prototype, m as any).mockImplementation(block),
      ),
    ];
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => close?.());

  const unknownTx = {
    id: 'tx-e2e-ro-1',
    status: 'APPROVED',
    amount_in_cents: 14990000,
    currency: 'COP',
    reference: 'sub_00000000-0000-4000-8000-000000000000',
  };

  it('evento firmado sin intento de pago: 200 y ninguna escritura', async () => {
    const res = await http.post(WEBHOOK).send(signedEvent(unknownTx));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expectNoWrites();
  });

  it('evento firmado con las propiedades en otro orden y la cabecera X-Event-Checksum: 200', async () => {
    const body = signedEvent(unknownTx, {
      properties: [
        'transaction.amount_in_cents',
        'transaction.reference',
        'transaction.status',
        'transaction.id',
      ],
    });
    const res = await http
      .post(WEBHOOK)
      .set('X-Event-Checksum', body.signature.checksum.toUpperCase())
      .send(body);
    expect(res.status).toBe(200);
    expectNoWrites();
  });

  it('otro tipo de evento firmado: 200 e ignorado', async () => {
    const body = {
      ...signedEvent(unknownTx),
      event: 'nequi_token.updated',
    };
    const res = await http.post(WEBHOOK).send(body);
    expect(res.status).toBe(200);
    expectNoWrites();
  });

  it.each([
    [
      'checksum alterado',
      (b: any) => ({
        ...b,
        signature: { ...b.signature, checksum: 'f'.repeat(64) },
      }),
    ],
    ['timestamp alterado', (b: any) => ({ ...b, timestamp: b.timestamp + 1 })],
    [
      'monto alterado',
      (b: any) => ({
        ...b,
        data: {
          transaction: { ...b.data.transaction, amount_in_cents: 100 },
        },
      }),
    ],
    [
      'estado alterado',
      (b: any) => ({
        ...b,
        data: { transaction: { ...b.data.transaction, status: 'DECLINED' } },
      }),
    ],
    ['sin signature', (b: any) => ({ ...b, signature: undefined })],
    [
      'firmado con otro secreto',
      () => signedEvent(unknownTx, { secret: 'otro' }),
    ],
  ])('%s: 401 sin detalle y sin escrituras', async (_name, mutate) => {
    const res = await http.post(WEBHOOK).send(mutate(signedEvent(unknownTx)));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Firma inválida',
    });
    expectNoWrites();
  });

  it('cabecera X-Event-Checksum distinta del cuerpo: 401', async () => {
    const res = await http
      .post(WEBHOOK)
      .set('X-Event-Checksum', 'a'.repeat(64))
      .send(signedEvent(unknownTx));
    expect(res.status).toBe(401);
  });

  it.each([
    ['cuerpo vacío', {}],
    ['sin data', { event: 'transaction.updated' }],
    ['data no es objeto', { event: 'transaction.updated', data: 'x' }],
  ])('%s: 400', async (_name, body) => {
    const res = await http.post(WEBHOOK).send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expectNoWrites();
  });

  it('transaction.updated firmado pero sin los campos de la transacción: 400', async () => {
    const body = signedEvent(
      { id: 'tx-x', status: 'APPROVED' },
      { properties: ['transaction.id', 'transaction.status'] },
    );
    const res = await http.post(WEBHOOK).send(body);
    expect(res.status).toBe(400);
    expectNoWrites();
  });
});

describeWritable(
  `Webhook de Wompi contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let ownerToken: string;
    let plan: SubscriptionPlan;
    let subscriptionId: string;

    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const subscriptionRow = () =>
      ds.getRepository(Subscription).findOneOrFail({
        where: { id: subscriptionId },
        relations: { plan: true },
      });
    const attempts = () =>
      ds.getRepository(PaymentHistory).find({
        where: { subscription: { id: subscriptionId } },
        order: { created_at: 'ASC' },
      });
    const subscribe = async () => {
      const res = await http
        .post('/api/subscriptions/subscribe')
        .set(auth(ownerToken))
        .send({ plan_id: plan.id });
      expect(res.status).toBe(201);
    };
    const txFor = (id: string, overrides: Partial<TxFields> = {}) => ({
      id,
      status: 'APPROVED',
      amount_in_cents: toCents(plan.price),
      currency: plan.currency,
      reference: `sub_${subscriptionId}`,
      ...overrides,
    });

    beforeAll(async () => {
      ({ app, http, close } = await startApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      jest
        .spyOn(WompiService.prototype, 'createPaymentLink')
        .mockResolvedValue('https://checkout.test/link');
      ({ owner } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
      plan = await ds
        .getRepository(SubscriptionPlan)
        .findOneOrFail({ where: { duration_months: 6 } });
      subscriptionId = (
        await ds.getRepository(Subscription).findOneOrFail({
          where: { tenant_id: owner.id },
          order: { created_at: 'DESC' },
        })
      ).id;
      await ds
        .getRepository(PaymentHistory)
        .delete({ subscription: { id: subscriptionId } });
      await resetTrialQuota(ds, owner.id, { used: 5 });
      await subscribe();
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('importe distinto (evento firmado): 200, no activa y el intento queda pending marcado como sospechoso', async () => {
      const body = signedEvent(
        txFor('tx-e2e-207-tampered', { amount_in_cents: 100 }),
      );
      const res = await http.post(WEBHOOK).send(body);
      expect(res.status).toBe(200);
      const sub = await subscriptionRow();
      expect(sub.status).toBe('trial');
      expect(sub.plan).toBeNull();
      const [attempt] = await attempts();
      expect(attempt.status).toBe('pending');
      expect(attempt.wompi_transaction_id).toBeNull();
      expect(attempt.metadata.suspicious_events).toEqual([
        expect.objectContaining({
          transaction_id: 'tx-e2e-207-tampered',
          amount_in_cents: 100,
          expected_amount_in_cents: toCents(plan.price),
        }),
      ]);

      // Moneda distinta: tampoco.
      await http
        .post(WEBHOOK)
        .send(signedEvent(txFor('tx-e2e-207-usd', { currency: 'USD' })));
      expect((await subscriptionRow()).status).toBe('trial');
    });

    it('PENDING firmado: 200 y nada cambia', async () => {
      const res = await http
        .post(WEBHOOK)
        .send(signedEvent(txFor('tx-e2e-207-ok', { status: 'PENDING' })));
      expect(res.status).toBe(200);
      expect((await subscriptionRow()).status).toBe('trial');
      expect((await attempts()).map((a) => a.status)).toEqual(['pending']);
    });

    it('APPROVED dos veces (mismo evento reenviado): un solo efecto', async () => {
      const body = signedEvent(txFor('tx-e2e-207-ok'));
      const first = await http.post(WEBHOOK).send(body);
      expect(first.status).toBe(200);
      const active = await subscriptionRow();
      expect(active.status).toBe('active');
      expect(active.plan.id).toBe(plan.id);
      const startedAt = active.subscription_start_date.getTime();

      const second = await http.post(WEBHOOK).send(body);
      expect(second.status).toBe(200);
      const again = await subscriptionRow();
      expect(again.subscription_start_date.getTime()).toBe(startedAt);
      expect(again.subscription_end_date.getTime()).toBe(
        active.subscription_end_date.getTime(),
      );
      const rows = await attempts();
      expect(rows.map((a) => [a.status, a.wompi_transaction_id])).toEqual([
        ['successful', 'tx-e2e-207-ok'],
      ]);
    });

    it('la misma aprobación recibida 5 veces a la vez: una sola activación', async () => {
      await subscribe(); // nuevo intento pending (misma referencia)
      const service = app.get(SubscriptionsService);
      const tx = txFor('tx-e2e-207-race');
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.applyWompiTransaction(tx)),
      );
      const outcomes = results.map((r) =>
        r.status === 'fulfilled' ? r.value.outcome : `error: ${r.reason}`,
      );
      expect(outcomes.filter((o) => o === 'activate')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(4);
      const rows = await attempts();
      expect(
        rows.filter((a) => a.wompi_transaction_id === 'tx-e2e-207-race'),
      ).toHaveLength(1);
      expect(rows.every((a) => a.status === 'successful')).toBe(true);
    });

    it('DECLINED firmado: el intento queda failed y la suscripción no cambia', async () => {
      await subscribe();
      const before = await subscriptionRow();
      const res = await http
        .post(WEBHOOK)
        .send(
          signedEvent(txFor('tx-e2e-207-declined', { status: 'DECLINED' })),
        );
      expect(res.status).toBe(200);
      const after = await subscriptionRow();
      expect(after.status).toBe(before.status);
      expect(after.subscription_start_date.getTime()).toBe(
        before.subscription_start_date.getTime(),
      );
      const rows = await attempts();
      expect(rows[rows.length - 1]).toMatchObject({
        status: 'failed',
        wompi_transaction_id: 'tx-e2e-207-declined',
      });
    });
  },
);
