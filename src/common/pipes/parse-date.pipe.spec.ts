import { BadRequestException } from '@nestjs/common';
import { ParseDatePipe } from './parse-date.pipe';

describe('ParseDatePipe (2.08: filtros opcionales)', () => {
  it('por defecto la fecha es obligatoria', () => {
    expect(() => new ParseDatePipe().transform(undefined)).toThrow(
      BadRequestException,
    );
  });

  it('con { optional: true }: ausente → undefined; presente → Date; inválida → 400', () => {
    const pipe = new ParseDatePipe({ optional: true });
    expect(pipe.transform(undefined)).toBeUndefined();
    expect(pipe.transform('')).toBeUndefined();
    expect(pipe.transform('2030-01-07T10:00:00-05:00')?.toISOString()).toBe(
      '2030-01-07T15:00:00.000Z',
    );
    expect(() => pipe.transform('nada')).toThrow(BadRequestException);
  });
});
