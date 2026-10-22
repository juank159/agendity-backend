import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { ErrorCode, LEGACY_STATUS } from '../constants/error-codes';
import { BusinessException } from '../exceptions/business.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function dbError(code: string, detail?: string) {
  const driverError = Object.assign(new Error('driver'), { code, detail });
  return new QueryFailedError('INSERT ...', [], driverError);
}

describe('AllExceptionsFilter (formato §3)', () => {
  const filter = new AllExceptionsFilter();
  beforeAll(() => Logger.overrideLogger(false));

  it('errores de class-validator: 400 VALIDATION_ERROR con message unido y details', () => {
    const body = filter.toBody(
      new BadRequestException([
        'email must be an email',
        'password should not be empty',
      ]),
    );
    expect(body).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'email must be an email\npassword should not be empty',
      details: ['email must be an email', 'password should not be empty'],
    });
  });

  it('BusinessException conserva code, texto y HTTP (incluido el legado)', () => {
    expect(
      filter.toBody(
        new BusinessException(
          ErrorCode.SLOT_UNAVAILABLE,
          'Horario no disponible',
          LEGACY_STATUS.SLOT_UNAVAILABLE,
        ),
      ),
    ).toEqual({
      statusCode: 400,
      code: 'SLOT_UNAVAILABLE',
      message: 'Horario no disponible',
    });
    expect(
      filter.toBody(
        new BusinessException(ErrorCode.OWNER_NOT_DELETABLE, 'No se puede'),
      ),
    ).toEqual({
      statusCode: 409,
      code: 'OWNER_NOT_DELETABLE',
      message: 'No se puede',
    });
  });

  it('mensajes propios se mantienen; los por defecto de Nest se traducen', () => {
    expect(
      filter.toBody(new UnauthorizedException('Credenciales inválidas')),
    ).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Credenciales inválidas',
    });
    expect(filter.toBody(new UnauthorizedException()).message).toBe(
      'No autorizado. Inicia sesión de nuevo.',
    );
    expect(filter.toBody(new ForbiddenException()).code).toBe('FORBIDDEN');
    expect(
      filter.toBody(new NotFoundException('Cannot GET /api/x')).message,
    ).toBe('Recurso no encontrado');
    expect(filter.toBody(new ThrottlerException())).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
    });
  });

  it('los 500 nunca exponen el mensaje interno', () => {
    for (const error of [
      new Error('password=1234 en la query'),
      new InternalServerErrorException('Error interno: detalle sensible'),
      'texto suelto',
    ]) {
      const body = filter.toBody(error);
      expect(body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Ha ocurrido un error interno. Por favor, intenta nuevamente.',
      });
    }
  });

  it('TypeORM: unique → 409 DUPLICATE_* o CONFLICT sin revelar el valor', () => {
    expect(
      filter.toBody(dbError('23505', 'Key (email)=(a@b.co) already exists.')),
    ).toEqual({
      statusCode: 409,
      code: 'DUPLICATE_EMAIL',
      message: 'Ya existe un registro con ese email',
    });
    expect(
      filter.toBody(dbError('23505', 'Key (phone)=(300) already exists.')).code,
    ).toBe('DUPLICATE_PHONE');
    const other = filter.toBody(
      dbError('23505', 'Key (name)=(Corte) already exists.'),
    );
    expect(other.code).toBe('CONFLICT');
    expect(other.message).not.toContain('Corte');
  });

  it('TypeORM: FK → 409, formato inválido → 400, no encontrado → 404, otro → 500', () => {
    expect(filter.toBody(dbError('23503')).statusCode).toBe(
      HttpStatus.CONFLICT,
    );
    expect(filter.toBody(dbError('22P02')).code).toBe('BAD_REQUEST');
    expect(filter.toBody(new EntityNotFoundError('User', {})).code).toBe(
      'NOT_FOUND',
    );
    expect(filter.toBody(dbError('XX000')).code).toBe('INTERNAL_ERROR');
  });
});
