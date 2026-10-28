import { QueryFailedError } from 'typeorm';
import { ClientsService } from './clients.service';

const BOGOTA = 'America/Bogota';

describe('ClientsService: errores de BD (2.08)', () => {
  it('un QueryFailedError (p. ej. 22P02 por id no UUID) llega tal cual al filtro global, no como 500', async () => {
    const badUuid = Object.assign(new QueryFailedError('q', [], new Error()), {
      code: '22P02',
    });
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      leftJoinAndSelect: jest.fn(() => qb),
      getOne: jest.fn(async () => {
        throw badUuid;
      }),
    };
    const repo = { createQueryBuilder: jest.fn(() => qb) };
    const service = new ClientsService(
      repo as any,
      { getTimezone: jest.fn(async () => BOGOTA) } as any,
    );
    await expect(service.findOne('no-uuid', 'tenant')).rejects.toBe(badUuid);
  });
});

describe('ClientsService: duplicados con su code (2.30)', () => {
  const tenant = 'tenant';
  const existing = { id: 'otro', phone: '3001112233', email: 'a@b.co' };

  const serviceWith = (found: object[]) => {
    const repo = {
      find: jest.fn(async () => found),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
    };
    return {
      service: new ClientsService(
        repo as any,
        { getTimezone: jest.fn(async () => BOGOTA) } as any,
      ),
      repo,
    };
  };

  const errorOf = async (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('debía fallar');
      },
      (error) => error,
    );

  it('teléfono repetido → 409 DUPLICATE_PHONE con el texto de siempre', async () => {
    const { service, repo } = serviceWith([existing]);
    const error = await errorOf(
      service.create(
        { name: 'N', lastname: 'L', phone: existing.phone } as any,
        tenant,
      ),
    );
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'DUPLICATE_PHONE',
      message: `Ya existe un cliente con el teléfono: ${existing.phone}`,
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('email repetido → 409 DUPLICATE_EMAIL con el texto de siempre', async () => {
    const { service } = serviceWith([existing]);
    const error = await errorOf(
      service.create(
        {
          name: 'N',
          lastname: 'L',
          phone: '3009998877',
          email: existing.email,
        } as any,
        tenant,
      ),
    );
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'DUPLICATE_EMAIL',
      message: `Ya existe un cliente con el email: ${existing.email}`,
    });
  });

  it('sin email y teléfono repetido de un cliente sin email → DUPLICATE_PHONE (2.20)', async () => {
    const { service } = serviceWith([{ ...existing, email: null }]);
    const error = await errorOf(
      service.create(
        { name: 'N', lastname: 'L', phone: existing.phone, email: null } as any,
        tenant,
      ),
    );
    expect(error.getResponse()).toMatchObject({ code: 'DUPLICATE_PHONE' });
  });

  it('editar: solo el propio cliente con ese teléfono no es duplicado', async () => {
    const { service, repo } = serviceWith([existing]);
    const qb: any = {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      leftJoinAndSelect: jest.fn(() => qb),
      getOne: jest.fn(async () => existing),
    };
    (repo as any).createQueryBuilder = jest.fn(() => qb);
    await expect(
      service.update(existing.id, { phone: existing.phone } as any, tenant),
    ).resolves.toBeDefined();
  });
});
