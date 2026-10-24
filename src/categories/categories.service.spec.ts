import {
  ConflictException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { CategoriesService } from './categories.service';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const CATEGORY = 'c0000000-0000-4000-8000-000000000003';

const dbError = (code: string) =>
  new QueryFailedError('SQL', [], Object.assign(new Error(code), { code }));

function build() {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    leftJoinAndSelect: jest.fn(() => qb),
    getOne: jest.fn(async () => ({ id: CATEGORY, ownerId: TENANT })),
  };
  const categories = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    remove: jest.fn(async () => undefined),
  };
  const users = { findOne: jest.fn(async () => ({ id: TENANT })) };
  return {
    service: new CategoriesService(categories as any, users as any),
    categories,
  };
}

describe('CategoriesService.handleError (2.17)', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('un QueryFailedError sale tal cual al filtro global (borrar con servicios: 23503 → 409, no 500)', async () => {
    const { service, categories } = build();
    const fk = dbError('23503');
    categories.remove.mockRejectedValueOnce(fk);
    await expect(service.remove(CATEGORY, TENANT)).rejects.toBe(fk);
  });

  it('una HttpException de otra clase (BusinessException) sale tal cual', async () => {
    const { service, categories } = build();
    const forbidden = new BusinessException(ErrorCode.FORBIDDEN, 'No');
    categories.find.mockRejectedValueOnce(forbidden);
    await expect(service.findAll(TENANT)).rejects.toBe(forbidden);
  });

  it('el 23505 conserva su texto propio (409)', async () => {
    const { service, categories } = build();
    categories.save.mockRejectedValueOnce(dbError('23505'));
    const error = await service
      .create({ name: 'Corte' } as any, TENANT)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain("el nombre 'Corte'");
  });

  it('las de siempre siguen igual (404) y lo desconocido → 500 sin detalle', async () => {
    const { service, categories } = build();
    categories.find.mockRejectedValueOnce(new NotFoundException('x'));
    await expect(service.findAll(TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    categories.find.mockRejectedValueOnce(new Error('interno'));
    const error = await service.findAll(TENANT).catch((e) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).not.toContain('interno');
  });
});
