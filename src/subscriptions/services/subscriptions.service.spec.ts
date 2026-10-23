import { NotFoundException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { BusinessException } from 'src/common/exceptions/business.exception';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const PENDING_ATTEMPT = {
  id: 'att-1',
  status: 'pending',
  amount: '149900.00',
  currency: 'COP',
  metadata: { plan_id: 'plan', reference: 'sub_sub-1' },
};
const NOW = new Date('2026-10-22T12:00:00');

/** Repositorio simulado: cualquier escritura queda registrada en `writes`. */
function fakeRepo(found: any = null) {
  const writes: string[] = [];
  const write =
    (name: string) =>
    async (...args: any[]) => {
      writes.push(name);
      return name === 'save' ? args[0] : { affected: 1 };
    };
  return {
    writes,
    findOne: jest.fn().mockResolvedValue(found),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((x) => x),
    save: jest.fn(write('save')),
    update: jest.fn(write('update')),
    insert: jest.fn(write('insert')),
    delete: jest.fn(write('delete')),
    manager: { count: jest.fn().mockResolvedValue(0) },
  };
}

function build(found: any = null) {
  const subscriptions = fakeRepo(found);
  const plans = fakeRepo();
  const payments = fakeRepo();
  const wompi = {
    createPaymentLink: jest.fn().mockResolvedValue('https://checkout/x'),
    findLatestTransactionByReference: jest.fn().mockResolvedValue(null),
    devShortcutsEnabled: false,
  };
  const service = new SubscriptionsService(
    plans as any,
    subscriptions as any,
    payments as any,
    wompi as any,
    { get: jest.fn() } as any,
  );
  return { service, subscriptions, plans, payments, wompi };
}

/**
 * EntityManager simulado de una transacción. Registra el orden de las
 * operaciones (`log`) y el SQL de la actualización condicional del trial.
 */
function fakeManager(row: any, opts: { affected?: number; tx?: boolean } = {}) {
  const log: string[] = [];
  const update: any = {};
  const lockQb: any = {
    leftJoinAndSelect: () => lockQb,
    where: (sql: string, p: any) => {
      log.push(`where ${sql} ${p.tenantId}`);
      return lockQb;
    },
    orderBy: () => lockQb,
    setLock: (mode: string, _v: any, tables: string[]) => {
      log.push(`lock ${mode} ${tables.join(',')}`);
      return lockQb;
    },
    getOne: async () => row,
  };
  const updateQb: any = {
    update: () => updateQb,
    set: (values: any) => {
      update.set = Object.fromEntries(
        Object.entries(values).map(([k, v]: any) => [k, v()]),
      );
      return updateQb;
    },
    where: (sql: string, p: any) => {
      update.where = [sql, p];
      return updateQb;
    },
    andWhere: (sql: string) => {
      (update.and ??= []).push(sql);
      return updateQb;
    },
    execute: async () => {
      log.push('update trial');
      return { affected: opts.affected ?? 1 };
    },
  };
  const manager: any = {
    queryRunner: { isTransactionActive: opts.tx ?? true },
    query: jest.fn(async (sql: string, params: any[]) => {
      log.push(`query ${sql} ${params.join(',')}`);
      return [];
    }),
    getRepository: () => ({ createQueryBuilder: () => lockQb }),
    createQueryBuilder: () => updateQb,
    create: jest.fn((_e, x) => ({ ...x })),
    save: jest.fn(async (x) => {
      log.push('save');
      return { id: 'nueva', ...x };
    }),
    count: jest.fn().mockResolvedValue(0),
  };
  return { manager, log, update };
}

const trial = (used: number) => ({
  id: 'sub-1',
  tenant_id: TENANT,
  status: 'trial',
  trial_appointments_used: used,
  trial_appointments_limit: 20,
  plan: null,
});

describe('SubscriptionsService: lecturas sin escrituras (2.03)', () => {
  it('check-limits sin fila: trial sin usar y NO crea la fila', async () => {
    const { service, subscriptions } = build(null);
    await expect(service.checkSubscriptionStatus(TENANT, NOW)).resolves.toEqual(
      { canCreateAppointment: true, message: 'Citas restantes en prueba: 20' },
    );
    expect(subscriptions.findOne.mock.calls[0][0].where).toEqual({
      tenant_id: TENANT,
    });
    expect(subscriptions.writes).toEqual([]);
  });

  it('check-limits de una activa vencida: SUBSCRIPTION_INACTIVE y NO guarda expired', async () => {
    const row = {
      id: 'x',
      tenant_id: TENANT,
      status: 'active',
      plan: { appointment_limit: -1 },
      subscription_end_date: new Date('2025-11-05'),
    };
    const { service, subscriptions } = build(row);
    const result = await service.checkSubscriptionStatus(TENANT, NOW);
    expect(result.canCreateAppointment).toBe(false);
    expect(result.code).toBe('SUBSCRIPTION_INACTIVE');
    expect(row.status).toBe('active');
    expect(subscriptions.writes).toEqual([]);
  });

  it('status sin fila: trial virtual del propio tenant, sin crearlo', async () => {
    const { service, subscriptions } = build(null);
    const view = await service.getSubscriptionStatus(TENANT, NOW);
    expect(view).toMatchObject({
      id: null,
      tenant_id: TENANT,
      status: 'trial',
      trial_appointments_used: 0,
      trial_appointments_limit: 20,
      plan: null,
    });
    expect(subscriptions.writes).toEqual([]);
  });

  it('status de una activa vencida: status=expired en la respuesta, la fila intacta', async () => {
    const row = {
      id: 'x',
      tenant_id: TENANT,
      status: 'active',
      plan: { appointment_limit: -1 },
      subscription_end_date: new Date('2025-11-05'),
    };
    const { service, subscriptions } = build(row);
    const view = await service.getSubscriptionStatus(TENANT, NOW);
    expect(view.status).toBe('expired');
    expect(row.status).toBe('active');
    expect(subscriptions.writes).toEqual([]);
  });

  it('sin tenant: 404 sin consultar (TypeORM ignoraría el where)', async () => {
    const { service, subscriptions } = build(trial(0));
    await expect(service.checkSubscriptionStatus(undefined)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getSubscriptionStatus('')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.getPaymentHistory(undefined)).rejects.toThrow(
      NotFoundException,
    );
    expect(subscriptions.findOne).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.consumeAppointmentQuota (2.03)', () => {
  it('trial: lock del negocio, fila FOR UPDATE y UPDATE condicional +1', async () => {
    const { service } = build();
    const { manager, log, update } = fakeManager(trial(19));
    const result = await service.consumeAppointmentQuota(TENANT, manager, NOW);

    expect(result.canCreateAppointment).toBe(true);
    expect(log).toEqual([
      `query SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) subscription:${TENANT}`,
      `where subscription.tenant_id = :tenantId ${TENANT}`,
      'lock pessimistic_write subscription',
      'update trial',
    ]);
    expect(update.set).toEqual({
      trial_appointments_used: 'trial_appointments_used + 1',
      is_trial_used: 'trial_appointments_used + 1 >= trial_appointments_limit',
    });
    expect(update.where).toEqual(['id = :id', { id: 'sub-1' }]);
    expect(update.and).toEqual([
      'status = :trial',
      'trial_appointments_used < trial_appointments_limit',
    ]);
  });

  it('trial agotado: TRIAL_LIMIT_REACHED con HTTP 400 (D-11) y sin UPDATE', async () => {
    const { service } = build();
    const { manager, log } = fakeManager(trial(20));
    const error = await service
      .consumeAppointmentQuota(TENANT, manager, NOW)
      .catch((e) => e);
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'TRIAL_LIMIT_REACHED',
      message:
        'Has alcanzado el límite de citas de prueba. Por favor, adquiere un plan para continuar.',
    });
    expect(log).not.toContain('update trial');
  });

  it('si el UPDATE condicional no afecta filas (otra cita se llevó la última): TRIAL_LIMIT_REACHED', async () => {
    const { service } = build();
    const { manager } = fakeManager(trial(19), { affected: 0 });
    const error = await service
      .consumeAppointmentQuota(TENANT, manager, NOW)
      .catch((e) => e);
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.getResponse()).toMatchObject({ code: 'TRIAL_LIMIT_REACHED' });
  });

  it('sin fila: crea el trial del tenant DENTRO de la transacción y consume 1', async () => {
    const { service, subscriptions } = build();
    const { manager, log } = fakeManager(null);
    await service.consumeAppointmentQuota(TENANT, manager, NOW);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        status: 'trial',
        trial_appointments_used: 0,
        trial_appointments_limit: 20,
      }),
    );
    expect(log.slice(-2)).toEqual(['save', 'update trial']);
    expect(subscriptions.writes).toEqual([]); // nada fuera de la transacción
  });

  it('plan activo ilimitado: permite sin tocar contadores', async () => {
    const { service } = build();
    const { manager, log } = fakeManager({
      id: 's',
      status: 'active',
      plan: { appointment_limit: -1 },
      subscription_end_date: new Date('2027-01-01'),
    });
    await expect(
      service.consumeAppointmentQuota(TENANT, manager, NOW),
    ).resolves.toMatchObject({ canCreateAppointment: true });
    expect(log).not.toContain('update trial');
    expect(manager.count).not.toHaveBeenCalled();
  });

  it('plan con límite: cuenta las citas del negocio en el periodo (bajo el lock)', async () => {
    const { service } = build();
    const start = new Date('2026-10-01');
    const { manager } = fakeManager({
      id: 's',
      status: 'active',
      plan: { appointment_limit: 3 },
      subscription_start_date: start,
      subscription_end_date: new Date('2026-11-01'),
    });
    manager.count.mockResolvedValue(3);
    const error = await service
      .consumeAppointmentQuota(TENANT, manager, NOW)
      .catch((e) => e);
    expect(error.getResponse()).toMatchObject({
      code: 'SUBSCRIPTION_INACTIVE',
    });
    const where = manager.count.mock.calls[0][1].where;
    expect(where.ownerId).toBe(TENANT);
    expect(where.created_at.value).toEqual(start);
  });

  it('activa vencida: SUBSCRIPTION_INACTIVE (400) sin escribir', async () => {
    const { service } = build();
    const { manager, log } = fakeManager({
      id: 's',
      status: 'active',
      plan: { appointment_limit: -1 },
      subscription_end_date: new Date('2025-11-05'),
    });
    const error = await service
      .consumeAppointmentQuota(TENANT, manager, NOW)
      .catch((e) => e);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'SUBSCRIPTION_INACTIVE',
      message: 'Tu suscripción ha expirado. Por favor, renueva tu plan.',
    });
    expect(log).not.toContain('update trial');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('fuera de una transacción: error de programación, sin consultar', async () => {
    const { service } = build();
    const { manager } = fakeManager(trial(0), { tx: false });
    await expect(
      service.consumeAppointmentQuota(TENANT, manager, NOW),
    ).rejects.toThrow('dentro de una transacción');
    expect(manager.query).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService: escrituras por tenant y duración del plan', () => {
  it('subscribe usa el tenant de la sesión (no el del DTO), crea un intento pending y NO toca la suscripción (2.15)', async () => {
    const { service, subscriptions, plans, payments } = build(trial(3));
    plans.findOne.mockResolvedValue({
      id: 'plan',
      name: 'Plan Profesional Mensual',
      price: 149900,
      currency: 'COP',
      duration_months: 6,
    });
    const result = await service.createPaidSubscription(TENANT, {
      tenant_id: '99999999-9999-4999-8999-999999999999',
      plan_id: 'plan',
    } as any);

    expect(subscriptions.findOne.mock.calls[0][0].where).toEqual({
      tenant_id: TENANT,
    });
    expect(subscriptions.writes).toEqual([]); // la suscripción, intacta
    const attempt = payments.save.mock.calls[0][0];
    expect(attempt).toMatchObject({
      tenant_id: TENANT,
      subscription: { id: 'sub-1' },
      amount: 149900,
      status: 'pending',
      metadata: { plan_id: 'plan', reference: 'sub_sub-1' },
    });
    expect(result.status).toBe('trial');
    expect(result.payment_link).toBe('https://checkout/x');
  });

  it('si Wompi no da el enlace, el intento queda failed y la suscripción intacta', async () => {
    const { service, subscriptions, plans, payments, wompi } = build(trial(3));
    plans.findOne.mockResolvedValue({ id: 'plan', price: 1, currency: 'COP' });
    wompi.createPaymentLink.mockRejectedValue(new Error('caído'));
    payments.save.mockImplementation(async (x) => ({ id: 'att-1', ...x }));
    await expect(
      service.createPaidSubscription(TENANT, { plan_id: 'plan' } as any),
    ).rejects.toThrow('caído');
    expect(subscriptions.writes).toEqual([]);
    expect(payments.save.mock.calls[1][0]).toMatchObject({
      id: 'att-1',
      status: 'failed',
    });
  });

  it('subscribe con un enlace real de Wompi guarda su id en el intento (para encontrarlo por payment_link_id)', async () => {
    const { service, plans, payments, wompi } = build(trial(3));
    plans.findOne.mockResolvedValue({ id: 'plan', price: 1, currency: 'COP' });
    wompi.createPaymentLink.mockResolvedValue(
      'https://checkout.wompi.co/l/test_Ab12',
    );
    payments.save.mockImplementation(async (x) => ({ id: 'att-1', ...x }));
    await service.createPaidSubscription(TENANT, { plan_id: 'plan' } as any);
    expect(payments.update).toHaveBeenCalledWith(
      { id: 'att-1' },
      {
        metadata: {
          plan_id: 'plan',
          reference: 'sub_sub-1',
          payment_link_id: 'test_Ab12',
        },
      },
    );
  });

  it('cron: marca expired solo las activas con la fecha de fin pasada', async () => {
    const { service, subscriptions } = build();
    await service.expireOverdueSubscriptions(NOW);
    const [where, values] = subscriptions.update.mock.calls[0];
    expect(where.status).toBe('active');
    expect(where.subscription_end_date.type).toBe('lessThan');
    expect(where.subscription_end_date.value).toBe(NOW);
    expect(values).toEqual({ status: 'expired' });
  });

  it('refresh-status sin intento pending: no consulta a Wompi ni aplica nada', async () => {
    const { service, wompi } = build(trial(3));
    const apply = jest.spyOn(service, 'applyWompiTransaction');
    await expect(service.refreshPendingSubscription(TENANT)).resolves.toEqual({
      success: false,
      message: 'No se encontraron cambios en la suscripción',
    });
    expect(wompi.findLatestTransactionByReference).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('refresh-status aplica la transacción de Wompi con la MISMA función que el webhook', async () => {
    const { service, payments, wompi } = build(trial(3));
    payments.findOne.mockResolvedValue(PENDING_ATTEMPT);
    const tx = {
      id: 'tx-1',
      status: 'APPROVED',
      amount_in_cents: 14990000,
      currency: 'COP',
      reference: 'sub_sub-1',
    };
    wompi.findLatestTransactionByReference.mockResolvedValue(tx);
    const apply = jest
      .spyOn(service, 'applyWompiTransaction')
      .mockResolvedValue({ outcome: 'activate' });
    await expect(service.refreshPendingSubscription(TENANT)).resolves.toEqual({
      success: true,
      message: 'Suscripción verificada y activada correctamente',
    });
    expect(wompi.findLatestTransactionByReference).toHaveBeenCalledWith(
      'sub_sub-1',
    );
    expect(apply).toHaveBeenCalledWith(tx);
  });

  it.each(['duplicate', 'pending', 'amount_mismatch', 'fail'] as const)(
    'refresh-status con resultado %p: success false',
    async (outcome) => {
      const { service, payments, wompi } = build(trial(3));
      payments.findOne.mockResolvedValue(PENDING_ATTEMPT);
      wompi.findLatestTransactionByReference.mockResolvedValue({
        id: 'tx-1',
        status: 'PENDING',
        amount_in_cents: 1,
        currency: 'COP',
        reference: 'sub_sub-1',
      });
      jest
        .spyOn(service, 'applyWompiTransaction')
        .mockResolvedValue({ outcome });
      const result = await service.refreshPendingSubscription(TENANT);
      expect(result.success).toBe(false);
    },
  );

  it('refresh-status sin transacción en Wompi y sin atajos: no aplica nada', async () => {
    const { service, payments, wompi } = build(trial(3));
    payments.findOne.mockResolvedValue(PENDING_ATTEMPT);
    wompi.findLatestTransactionByReference.mockResolvedValue(null);
    const apply = jest.spyOn(service, 'applyWompiTransaction');
    expect((await service.refreshPendingSubscription(TENANT)).success).toBe(
      false,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it('refresh-status con el atajo de desarrollo: aplica una aprobación sintética del importe del intento (idempotente por intento)', async () => {
    const { service, payments, wompi } = build(trial(3));
    wompi.devShortcutsEnabled = true;
    payments.findOne.mockResolvedValue(PENDING_ATTEMPT);
    wompi.findLatestTransactionByReference.mockResolvedValue(null);
    const apply = jest
      .spyOn(service, 'applyWompiTransaction')
      .mockResolvedValue({ outcome: 'activate' });
    const result = await service.refreshPendingSubscription(TENANT);
    expect(result.success).toBe(true);
    expect(apply).toHaveBeenCalledWith({
      id: 'dev_att-1',
      status: 'APPROVED',
      amount_in_cents: 14990000,
      currency: 'COP',
      reference: 'sub_sub-1',
    });
  });

  it('cancelar un plan pagado: canceled en la fila, vigente (active) hasta la fecha de fin', async () => {
    const end = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    const { service, subscriptions } = build({
      id: 'sub-1',
      tenant_id: TENANT,
      status: 'active',
      plan: { appointment_limit: -1 },
      subscription_end_date: end,
    });
    const result: any = await service.cancelSubscription(TENANT);
    expect(subscriptions.save.mock.calls[0][0]).toMatchObject({
      status: 'canceled',
      subscription_end_date: end,
    });
    expect(result.status).toBe('active');
    expect(result.cancel_at_period_end).toBe(true);
  });
});

describe('SubscriptionsService.applyWompiTransaction (2.07)', () => {
  const APPROVED = {
    id: 'tx-1',
    status: 'APPROVED',
    amount_in_cents: 14990000,
    currency: 'COP',
    reference: 'sub_sub-1',
  };
  const lockedAttempt = (o: Record<string, any> = {}) => ({
    id: 'att-1',
    tenant_id: TENANT,
    subscription_id: 'sub-1',
    status: 'pending',
    amount: '149900.00',
    currency: 'COP',
    wompi_transaction_id: null,
    metadata: { plan_id: 'semestral', reference: 'sub_sub-1' },
    created_at: new Date('2026-10-22T10:00:00Z'),
    ...o,
  });

  /** Manager de la transacción: guarda el orden de lo que se hace en `log`. */
  function applyHarness(
    attempts: any[],
    {
      affected = 1,
      tenants = attempts.length ? [{ tenant_id: TENANT }] : [],
    } = {},
  ) {
    const log: string[] = [];
    const updates: Array<{ set: any; where: any[] }> = [];
    const plain: Array<[string, any, any]> = [];
    const updateQb: any = {
      update: (entity: any) => {
        updates.push({ set: null, where: [entity.name] });
        return updateQb;
      },
      set: (values: any) => {
        updates[updates.length - 1].set = values;
        return updateQb;
      },
      where: (sql: string, p: any) => {
        updates[updates.length - 1].where.push(sql, p);
        return updateQb;
      },
      andWhere: (sql: string, p: any) => {
        updates[updates.length - 1].where.push(sql, p);
        return updateQb;
      },
      execute: async () => {
        log.push('update attempt');
        return { affected };
      },
    };
    const subscriptionQb: any = {
      leftJoinAndSelect: () => subscriptionQb,
      where: () => subscriptionQb,
      setLock: (mode: string) => {
        log.push(`lock subscription ${mode}`);
        return subscriptionQb;
      },
      getOne: async () => ({ id: 'sub-1', status: 'trial', plan: null }),
    };
    const manager: any = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('DISTINCT tenant_id')) return tenants;
        if (sql.includes('pg_advisory_xact_lock')) {
          log.push('advisory lock');
          return [];
        }
        if (sql.includes('FOR UPDATE')) {
          log.push('select attempts for update');
          return attempts;
        }
        throw new Error(`SQL inesperado: ${sql}`);
      }),
      createQueryBuilder: () => updateQb,
      getRepository: () => ({ createQueryBuilder: () => subscriptionQb }),
      findOne: jest.fn(async () => ({ id: 'semestral', duration_months: 6 })),
      update: jest.fn(async (entity: any, where: any, values: any) => {
        log.push(`update ${entity.name}`);
        plain.push([entity.name, where, values]);
        return { affected: 1 };
      }),
    };
    const { service, payments } = build();
    (payments.manager as any).transaction = jest.fn(async (cb: any) =>
      cb(manager),
    );
    return { service, manager, log, updates, plain };
  }

  it('APPROVED con el importe del intento: lock del negocio → intento FOR UPDATE → UPDATE condicional → activa el plan del intento', async () => {
    const { service, manager, log, updates, plain } = applyHarness([
      lockedAttempt(),
    ]);
    const result = await service.applyWompiTransaction(APPROVED);
    expect(result).toEqual({
      outcome: 'activate',
      attemptId: 'att-1',
      subscriptionId: 'sub-1',
    });
    expect(log).toEqual([
      'advisory lock',
      'select attempts for update',
      'update attempt',
      'lock subscription pessimistic_write',
      'update Subscription',
    ]);
    expect(manager.query.mock.calls[1][1]).toEqual([`subscription:${TENANT}`]);
    expect(updates[0].set).toMatchObject({
      status: 'successful',
      wompi_transaction_id: 'tx-1',
    });
    expect(updates[0].where).toContain('status IN (:...open)');
    const [, where, values] = plain[0];
    expect(where).toEqual({ id: 'sub-1' });
    expect(values.status).toBe('active');
    expect(values.plan).toEqual({ id: 'semestral' });
    const months =
      (values.subscription_end_date.getFullYear() -
        values.subscription_start_date.getFullYear()) *
        12 +
      values.subscription_end_date.getMonth() -
      values.subscription_start_date.getMonth();
    expect(months).toBe(6);
  });

  it('idempotencia: si el UPDATE condicional no afecta filas (otro evento ya lo aplicó) no vuelve a activar', async () => {
    const { service, log } = applyHarness([lockedAttempt()], { affected: 0 });
    const result = await service.applyWompiTransaction(APPROVED);
    expect(result.outcome).toBe('duplicate');
    expect(log).not.toContain('update Subscription');
  });

  it('idempotencia: el mismo evento con el intento ya pagado por esa transacción no escribe nada', async () => {
    const { service, log } = applyHarness([
      lockedAttempt({ status: 'successful', wompi_transaction_id: 'tx-1' }),
    ]);
    expect((await service.applyWompiTransaction(APPROVED)).outcome).toBe(
      'duplicate',
    );
    expect(log).toEqual(['advisory lock', 'select attempts for update']);
  });

  it('importe distinto: no activa; lo anota como sospechoso una sola vez', async () => {
    const { service, log, plain } = applyHarness([lockedAttempt()]);
    const tampered = { ...APPROVED, amount_in_cents: 100 };
    expect((await service.applyWompiTransaction(tampered)).outcome).toBe(
      'amount_mismatch',
    );
    expect(log).not.toContain('update attempt');
    expect(log).not.toContain('update Subscription');
    expect(plain[0][0]).toBe('PaymentHistory');
    expect(plain[0][2].metadata).toMatchObject({
      plan_id: 'semestral',
      suspicious_events: [
        {
          transaction_id: 'tx-1',
          amount_in_cents: 100,
          expected_amount_in_cents: 14990000,
        },
      ],
    });

    const again = applyHarness([
      lockedAttempt({ metadata: plain[0][2].metadata }),
    ]);
    await again.service.applyWompiTransaction(tampered);
    expect(again.plain).toEqual([]);
  });

  it('DECLINED: intento failed (solo si seguía pending) y la suscripción intacta', async () => {
    const { service, log, updates } = applyHarness([lockedAttempt()]);
    const result = await service.applyWompiTransaction({
      ...APPROVED,
      status: 'DECLINED',
    });
    expect(result.outcome).toBe('fail');
    expect(updates[0].set).toMatchObject({
      status: 'failed',
      wompi_transaction_id: 'tx-1',
    });
    expect(updates[0].where).toContain('status = :pending');
    expect(log).not.toContain('update Subscription');
  });

  it('PENDING: no escribe', async () => {
    const { service, log } = applyHarness([lockedAttempt()]);
    expect(
      (await service.applyWompiTransaction({ ...APPROVED, status: 'PENDING' }))
        .outcome,
    ).toBe('pending');
    expect(log).toEqual(['advisory lock', 'select attempts for update']);
  });

  it('referencia sin intento: no toma locks ni escribe', async () => {
    const { service, log } = applyHarness([]);
    expect((await service.applyWompiTransaction(APPROVED)).outcome).toBe(
      'no_attempt',
    );
    expect(log).toEqual([]);
  });
});
