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
  return { service: new SchedulesService(repo as any, users as any), repo, qb };
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
