import { Logger, NotFoundException } from '@nestjs/common';
import { SyncPushService } from './sync-push.service';

// Transacción simulada: el `work` recibe el mismo `ds`; si lanza, la tabla
// en memoria vuelve a como estaba (rollback). La real: test/sync-push.e2e.
jest.mock('src/common/database/ambient-transaction', () => ({
  inSavepoint: (work: () => Promise<unknown>) => work(),
  runInAmbientTransaction: async (ds: any, work: (tx: any) => Promise<any>) => {
    const restore = ds.snapshot();
    try {
      return await work(ds);
    } catch (error) {
      restore();
      throw error;
    }
  },
}));

const OWNER = {
  id: 'owner',
  name: 'D',
  email: 'd@x.co',
  roles: ['Owner'],
  tenantId: 'owner',
  ownerId: 'owner',
} as any;
const EMPLOYEE = { ...OWNER, id: 'emp', roles: ['Employee'] };
const CLIENT = 'c0000000-0000-4000-8000-000000000001';

function build(clients: Record<string, jest.Mock> = {}) {
  const stored = new Map<string, any>();
  const query = jest.fn(async (sql: string, params: any[]) => {
    if (sql.startsWith('SELECT tenant_id, user_id, status, result')) {
      const row = stored.get(params[0]);
      return row ? [row] : [];
    }
    if (sql.includes('INSERT INTO sync_mutations')) {
      stored.set(params[0], {
        tenant_id: params[1],
        user_id: params[2],
        status: 'pending',
      });
      return [{ mutation_id: params[0] }];
    }
    if (sql.startsWith('UPDATE sync_mutations')) {
      stored.set(params[0], {
        ...stored.get(params[0]),
        status: params[1],
        result: JSON.parse(params[2]),
      });
      return [];
    }
    if (sql.startsWith('DELETE FROM sync_mutations')) {
      stored.delete(params[0]);
      return [];
    }
    if (sql.includes('sync_id_aliases')) return [];
    throw new Error(`SQL inesperado: ${sql}`);
  });
  const ds = {
    query,
    getRepository: () => ({ exist: async () => false }),
    snapshot: () => {
      const copy = new Map(stored);
      return () => {
        stored.clear();
        copy.forEach((v, k) => stored.set(k, v));
      };
    },
  };
  const service = new SyncPushService(
    ds as any,
    { update: jest.fn(async () => ({})), remove: jest.fn(), ...clients } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, stored, query };
}

const mutation = (over: Record<string, unknown> = {}) => ({
  mutation_id: `m-${Math.random()}`,
  type: 'client.update',
  entity_id: CLIENT,
  payload: { name: 'Ana' },
  client_time: new Date().toISOString(),
  ...over,
});

describe('SyncPushService (10.01b)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('hora del dispositivo: hasta 30 días atrás y 5 min adelante', async () => {
    const { service } = build();
    const day = 24 * 3_600_000;
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const { results } = await service.push(OWNER, {
      mutations: [
        mutation({ client_time: at(-29 * day) }),
        mutation({ client_time: at(-31 * day) }),
        mutation({ client_time: at(4 * 60_000) }),
        mutation({ client_time: at(6 * 60_000) }),
      ],
    } as any);
    expect(results.map((r) => r.status)).toEqual([
      'applied',
      'rejected',
      'applied',
      'rejected',
    ]);
  });

  it('solo Owner (como la ruta online) y payload validado con el DTO', async () => {
    const { service } = build();
    const { results } = await service.push(EMPLOYEE, {
      mutations: [
        mutation({ type: 'client.delete', payload: {} }),
        mutation({ payload: { name: 'Ana', inventado: 1 } }),
      ],
    } as any);
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['rejected', 'FORBIDDEN'],
      ['rejected', 'VALIDATION_ERROR'],
    ]);
  });

  it('idempotente: la misma mutación no se vuelve a aplicar', async () => {
    const update = jest.fn(async () => ({}));
    const { service } = build({ update });
    const same = mutation();
    const first = await service.push(OWNER, { mutations: [same] } as any);
    const second = await service.push(OWNER, { mutations: [same] } as any);
    expect(second).toEqual(first);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('borrado de algo que ya no existe: aplicado; editarlo: conflicto NOT_FOUND', async () => {
    const gone = jest.fn(async () => {
      throw new NotFoundException('no');
    });
    const { service } = build({ update: gone, remove: gone });
    const { results } = await service.push(OWNER, {
      mutations: [mutation(), mutation({ type: 'client.delete', payload: {} })],
    } as any);
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['conflict', 'NOT_FOUND'],
      ['applied', undefined],
    ]);
  });

  it('error del servidor: retry y no se guarda (reenviarla la vuelve a intentar)', async () => {
    const boom = jest.fn(async () => {
      throw new Error('caída');
    });
    const { service, stored } = build({ update: boom });
    const one = mutation();
    const { results } = await service.push(OWNER, { mutations: [one] } as any);
    expect(results[0].status).toBe('retry');
    expect(stored.has(one.mutation_id)).toBe(false);
  });

  it('un mutation_id de otro usuario o de otro negocio: rechazo genérico, nunca su resultado', async () => {
    const { service } = build();
    const same = mutation();
    const first = await service.push(OWNER, { mutations: [same] } as any);
    expect(first.results[0].status).toBe('applied');
    for (const other of [
      { ...EMPLOYEE }, // mismo negocio, otro usuario
      { ...OWNER, id: 'otro', tenantId: 'otro-negocio' },
    ]) {
      const { results } = await service.push(other, {
        mutations: [same],
      } as any);
      expect(results[0]).toEqual({
        mutation_id: same.mutation_id,
        entity_id: same.entity_id,
        status: 'rejected',
        code: 'CONFLICT',
        message: 'mutation_id ya usado',
      });
    }
  });

  it('si la transacción se cae a mitad (p. ej. al guardar el resultado), no queda la mutación: retry y el reintento aplica', async () => {
    const update = jest.fn(async () => ({}));
    const { service, stored, query } = build({ update });
    const same = mutation();
    const real = query.getMockImplementation()!;
    query.mockImplementationOnce(real); // SELECT del resultado guardado
    query.mockImplementationOnce(real); // INSERT de la reserva
    query.mockImplementationOnce(async () => {
      throw new Error('conexión perdida'); // UPDATE del resultado
    });
    const first = await service.push(OWNER, { mutations: [same] } as any);
    expect(first.results[0]).toMatchObject({ status: 'retry' });
    expect(stored.has(same.mutation_id)).toBe(false); // sin pending huérfano
    const second = await service.push(OWNER, { mutations: [same] } as any);
    expect(second.results[0]).toMatchObject({ status: 'applied' });
    expect(stored.get(same.mutation_id).status).toBe('applied');
  });
});
