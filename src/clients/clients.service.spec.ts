import { QueryFailedError } from 'typeorm';
import { ClientsService } from './clients.service';

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
    const service = new ClientsService(repo as any);
    await expect(service.findOne('no-uuid', 'tenant')).rejects.toBe(badUuid);
  });
});
