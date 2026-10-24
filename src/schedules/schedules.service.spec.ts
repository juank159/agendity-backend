import { BadRequestException } from '@nestjs/common';
import { SchedulesService } from './schedules.service';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const PRO = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build(overlap: object | null = null) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getOne: jest.fn(async () => overlap),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'h1', ...x })),
    findOne: jest.fn(),
  };
  const users = { findTenantMember: jest.fn(async (id: string) => ({ id })) };
  // Transacción simulada (2.17): el repositorio del manager es el mismo mock.
  const manager = {
    getRepository: jest.fn(() => repo),
    query: jest.fn(async () => [{}]),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
      work(manager),
    ),
  };
  return {
    service: new SchedulesService(repo as any, users as any, dataSource as any),
    repo,
    qb,
    manager,
    dataSource,
  };
}

const dto = {
  user_id: PRO,
  day_of_week: 7,
  start_time: '10:00',
  end_time: '12:00',
  is_available: true,
};

describe('SchedulesService (2.08)', () => {
  it('el solapamiento compara con parámetros de tipo time (sin CAST Postgres daba 500)', async () => {
    const { service, qb } = build();
    await service.create(dto, TENANT);
    const overlapClause = qb.andWhere.mock.calls
      .map(([sql]) => sql)
      .find((sql: string) => sql.includes('OVERLAPS'));
    expect(overlapClause).toContain('CAST(:startTime AS time)');
    expect(overlapClause).toContain('CAST(:endTime AS time)');
  });

  it('solapado → 400; inicio >= fin → 400 sin consultar solapes', async () => {
    await expect(
      build({ id: 'otro' }).service.create(dto, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    const { service, qb } = build();
    await expect(
      service.create({ ...dto, end_time: '09:00' }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(qb.getOne).not.toHaveBeenCalled();
  });

  it('update con solo end_time valida el rango resultante (horas de BD con segundos)', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValue({
      id: 'h1',
      user: { id: PRO },
      day_of_week: 7,
      start_time: '10:00:00',
      end_time: '12:00:00',
    });
    await expect(
      service.update('h1', { end_time: '09:30' }, TENANT),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('h1', { end_time: '12:30' }, TENANT),
    ).resolves.toMatchObject({ end_time: '12:30' });
  });
});

describe('SchedulesService (escrituras en transacción, 2.17)', () => {
  const item = {
    day_of_week: 1,
    start_time: '09:00',
    end_time: '12:00',
    is_available: true,
  };

  it('createBatch: lock del profesional y todo el lote en UNA transacción', async () => {
    const { service, repo, manager, dataSource } = build();
    await service.createBatch(PRO, [item, { ...item, day_of_week: 2 }], TENANT);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const [lockSql, lockParams] = manager.query.mock.calls[0] as any[];
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(lockParams).toEqual([`schedule:${PRO}`]);
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
      repo.save.mock.invocationCallOrder[0],
    );
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('createBatch: un solape a mitad hace fallar la transacción entera (el error sale de ella)', async () => {
    const { service, repo, qb, dataSource } = build();
    qb.getOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'x' });
    const run = service.createBatch(PRO, [item, { ...item }], TENANT);
    await expect(run).rejects.toBeInstanceOf(BadRequestException);
    // El primero se guardó DENTRO de la transacción que falla → rollback.
    expect(repo.save).toHaveBeenCalledTimes(1);
    await expect(
      dataSource.transaction.mock.results[0].value,
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createBatch: un rango inválido en cualquier elemento → 400 sin abrir la transacción', async () => {
    const { service, dataSource, repo } = build();
    await expect(
      service.createBatch(
        PRO,
        [item, { ...item, start_time: '13:00', end_time: '12:00' }],
        TENANT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create y update también comprueban solapes y guardan bajo el mismo lock', async () => {
    const { service, manager, repo } = build();
    await service.create(dto, TENANT);
    repo.findOne.mockResolvedValue({
      id: 'h1',
      user: { id: PRO },
      day_of_week: 7,
      start_time: '10:00:00',
      end_time: '12:00:00',
    });
    await service.update('h1', { end_time: '13:00' }, TENANT);
    const locks = manager.query.mock.calls.filter(([sql]: any[]) =>
      String(sql).includes('pg_advisory_xact_lock'),
    );
    expect(locks).toHaveLength(2);
  });
});
