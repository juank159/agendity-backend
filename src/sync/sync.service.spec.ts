import { BadRequestException } from '@nestjs/common';
import { changesQuery, SyncService } from './sync.service';
import { SYNC_ENTITIES, visibleEntities } from './sync-entities';

const owner = { tenantId: 't1', userId: 'u-owner', employee: false };
const employee = { tenantId: 't1', userId: 'u-emp', employee: true };

describe('SyncService (10.01a)', () => {
  it('Employee: sin pagos, métodos de pago ni reseñas; sus citas y bloqueos por usuario', () => {
    const names = visibleEntities(employee).map((e) => e.name);
    expect(names).not.toEqual(
      expect.arrayContaining(['payments', 'custom_payment_methods', 'reviews']),
    );
    const { sql, params } = changesQuery(
      employee,
      visibleEntities(employee),
      '10',
      501,
    );
    expect(sql).toMatch(/FROM "appointments"[\s\S]*?professional_id = \$3/);
    expect(sql).toMatch(/FROM "time_block"[\s\S]*?"userId" = \$3/);
    expect(sql).toMatch(/FROM "notifications"[\s\S]*?receiver_id = \$3/);
    expect(sql).not.toMatch(/FROM "clients"[^U]*\$3/);
    expect(params.slice(0, 4)).toEqual(['t1', '10', 'u-emp', 501]);
    expect(params[5]).toEqual(['appointments', 'time_block', 'notifications']);
  });

  it('Owner: todo el negocio; solo sus notificaciones; nunca leave_scope ajenos', () => {
    expect(visibleEntities(owner)).toHaveLength(SYNC_ENTITIES.length);
    const { sql, params } = changesQuery(owner, visibleEntities(owner), '0', 3);
    expect(sql).not.toMatch(/FROM "appointments"[^U]*\$3/);
    expect(sql).toMatch(/FROM "notifications"[\s\S]*?receiver_id = \$3/);
    expect(sql).toContain("kind = 'delete' OR scope_user_id = $3");
    expect(params[5]).toEqual(['notifications']);
  });

  it('página: cursor = última versión entregada; has_more si hay más; borradas entre medias se omiten', async () => {
    const rows = [
      { entity: 'clients', id: 'c1', version: '5', op: 'upsert' },
      { entity: 'clients', id: 'gone', version: '6', op: 'upsert' },
      { entity: 'clients', id: 'c2', version: '7', op: 'delete' },
      { entity: 'clients', id: 'c3', version: '8', op: 'upsert' },
    ];
    const find = jest.fn(async () => [{ id: 'c1', name: 'Ana' }]);
    const ds = {
      query: jest.fn(async () => rows),
      manager: { getRepository: () => ({ find }) },
    };
    const page = await new SyncService(ds as any).changes(owner, '4', 3);
    expect(page).toEqual({
      changes: [
        {
          entity: 'clients',
          id: 'c1',
          version: '5',
          op: 'upsert',
          data: { id: 'c1', name: 'Ana' },
        },
        { entity: 'clients', id: 'c2', version: '7', op: 'delete', data: null },
      ],
      cursor: '7',
      has_more: true,
    });
  });

  it('cursor inválido → 400', async () => {
    await expect(
      new SyncService({} as any).changes(owner, '-1', 10),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
