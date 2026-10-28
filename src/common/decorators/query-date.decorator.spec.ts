import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { parseQueryDate } from './query-date.decorator';
import { timeZoneFrom } from './tenant-time-zone.decorator';

const BOGOTA = 'America/Bogota';
const CARACAS = 'America/Caracas';
const iso = (d: Date | undefined) => d?.toISOString();

describe('parseQueryDate (6.02: fechas de la query en la zona del tenant)', () => {
  it('por defecto la fecha es obligatoria', () => {
    expect(() => parseQueryDate(undefined, BOGOTA)).toThrow(
      BadRequestException,
    );
  });

  it('con { optional: true }: ausente → undefined; presente → Date; inválida → 400', () => {
    const optional = { optional: true };
    expect(parseQueryDate(undefined, BOGOTA, optional)).toBeUndefined();
    expect(parseQueryDate('', BOGOTA, optional)).toBeUndefined();
    expect(
      iso(parseQueryDate('2030-01-07T10:00:00-05:00', BOGOTA, optional)),
    ).toBe('2030-01-07T15:00:00.000Z');
    expect(() => parseQueryDate('nada', BOGOTA, optional)).toThrow(
      BadRequestException,
    );
    expect(() => parseQueryDate(['2030-01-07'], BOGOTA, optional)).toThrow(
      BadRequestException,
    );
  });

  it('solo fecha o sin offset: hora de pared en la zona de CADA tenant', () => {
    expect(iso(parseQueryDate('2030-01-07', BOGOTA))).toBe(
      '2030-01-07T05:00:00.000Z',
    );
    expect(iso(parseQueryDate('2030-01-07', CARACAS))).toBe(
      '2030-01-07T04:00:00.000Z',
    );
    expect(iso(parseQueryDate('2030-01-07T08:00:00', CARACAS))).toBe(
      '2030-01-07T12:00:00.000Z',
    );
    // Con offset: ese instante, sea cual sea la zona.
    expect(iso(parseQueryDate('2030-01-07T08:00:00Z', CARACAS))).toBe(
      '2030-01-07T08:00:00.000Z',
    );
  });

  it('rangeEnd: solo fecha = el día entero del negocio (00:00 del siguiente)', () => {
    expect(iso(parseQueryDate('2030-01-07', CARACAS, { rangeEnd: true }))).toBe(
      '2030-01-08T04:00:00.000Z',
    );
  });

  it('sin zona resuelta en la petición: 500 (nunca una zona inventada)', () => {
    expect(() => timeZoneFrom({})).toThrow(InternalServerErrorException);
    expect(timeZoneFrom({ tenantTimeZone: CARACAS })).toBe(CARACAS);
  });
});
