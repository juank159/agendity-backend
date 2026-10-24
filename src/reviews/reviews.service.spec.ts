import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AppointmentStatus } from 'src/common/enums/status.enum';
import { ReviewsService } from './reviews.service';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const APPOINTMENT = 'c0000000-0000-4000-8000-000000000004';

const dbError = (code: string) =>
  new QueryFailedError('SQL', [], Object.assign(new Error(code), { code }));

function build() {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    leftJoinAndSelect: jest.fn(() => qb),
    getOne: jest.fn(async () => null),
  };
  const reviews = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  };
  const appointments = {
    findOne: jest.fn(async () => ({
      id: APPOINTMENT,
      status: AppointmentStatus.COMPLETED,
    })),
  };
  return {
    service: new ReviewsService(reviews as any, appointments as any),
    reviews,
    appointments,
  };
}

const dto = {
  appointment_id: APPOINTMENT,
  rating: 5,
  comment: 'Muy buen servicio',
} as any;

describe('ReviewsService.handleError (2.17)', () => {
  beforeEach(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('una HttpException ajena a 400/404 (BusinessException 403) sale tal cual, no 500', async () => {
    const { service, appointments } = build();
    const forbidden = new BusinessException(ErrorCode.FORBIDDEN, 'No');
    appointments.findOne.mockRejectedValueOnce(forbidden);
    await expect(service.create(dto, TENANT)).rejects.toBe(forbidden);
  });

  it('un QueryFailedError (reseña duplicada por carrera: 23505) sale al filtro global', async () => {
    const { service, reviews } = build();
    const unique = dbError('23505');
    reviews.save.mockRejectedValueOnce(unique);
    await expect(service.create(dto, TENANT)).rejects.toBe(unique);
  });

  it('404 sigue igual y lo desconocido → 500 sin detalle', async () => {
    const { service, appointments, reviews } = build();
    appointments.findOne.mockRejectedValueOnce(new NotFoundException('x'));
    await expect(service.create(dto, TENANT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    reviews.save.mockRejectedValueOnce(new Error('interno'));
    const error = await service.create(dto, TENANT).catch((e) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.message).not.toContain('interno');
  });
});
