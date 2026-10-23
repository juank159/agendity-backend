import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { ServicesService } from './services.service';
import { UpdateServiceDto } from './dto/update-service.dto';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';

function build({ nameTaken = false } = {}) {
  const current = {
    id: 'srv-1',
    ownerId: TENANT,
    name: 'Corte',
    price: '10.00',
    categoryId: 'cat-1',
    category: { id: 'cat-1' },
    onlineBooking: false,
    priceType: 'Precio variable',
    deposit: 5,
  };
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    leftJoinAndSelect: jest.fn(() => qb),
    getOne: jest.fn(async () => ({ ...current })),
    getExists: jest.fn(async () => nameTaken),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
  };
  const categories = {
    findOne: jest.fn(async (id: string) => ({ id })),
  };
  const service = new ServicesService(repo as any, categories as any);
  return { service, repo, categories, qb };
}

/** Como llega del ValidationPipe (PartialType + class-transformer). */
const dto = (body: object) => plainToInstance(UpdateServiceDto, body);

describe('ServicesService.update (2.08)', () => {
  it('sin categoryId también guarda los cambios, y no pisa lo que no se envía', async () => {
    const { service, repo, categories } = build();
    await service.update('srv-1', dto({ price: 20 }), TENANT);
    const saved = repo.save.mock.calls[0][0];
    expect(saved.price).toBe(20);
    expect(saved).toMatchObject({
      categoryId: 'cat-1',
      onlineBooking: false,
      priceType: 'Precio variable',
      deposit: 5,
    });
    expect(categories.findOne).not.toHaveBeenCalled();
  });

  it('con categoryId valida la categoría en el negocio y la asigna', async () => {
    const { service, repo, categories } = build();
    await service.update('srv-1', dto({ categoryId: 'cat-2' }), TENANT);
    expect(categories.findOne).toHaveBeenCalledWith('cat-2', TENANT);
    expect(repo.save.mock.calls[0][0]).toMatchObject({
      categoryId: 'cat-2',
      category: { id: 'cat-2' },
    });
  });

  it('renombrar a un nombre que ya usa otro servicio del negocio → 409', async () => {
    const { service, repo, qb } = build({ nameTaken: true });
    await expect(
      service.update('srv-1', dto({ name: 'Tinte' }), TENANT),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(qb.andWhere).toHaveBeenCalledWith('service.id <> :excludeId', {
      excludeId: 'srv-1',
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('23505 del índice (owner_id, name) en una carrera → 409; otros errores de BD van al filtro global', async () => {
    const { service, repo } = build();
    const unique = Object.assign(new QueryFailedError('q', [], new Error()), {
      code: '23505',
    });
    repo.save.mockRejectedValueOnce(unique);
    await expect(
      service.update('srv-1', dto({ name: 'Tinte' }), TENANT),
    ).rejects.toBeInstanceOf(ConflictException);

    const badUuid = Object.assign(new QueryFailedError('q', [], new Error()), {
      code: '22P02',
    });
    repo.save.mockRejectedValueOnce(badUuid);
    await expect(
      service.update('srv-1', dto({ price: 1 }), TENANT),
    ).rejects.toBe(badUuid);
  });
});
