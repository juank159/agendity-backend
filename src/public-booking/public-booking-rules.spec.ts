import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePublicBookingDto } from './dto/public-booking.dto';
import {
  normalizePhone,
  orderForAnyProfessional,
  phoneDigits,
  PUBLIC_PHONE,
  unionOfStarts,
} from './public-booking-rules';

describe('reserva pública: reglas (9.01)', () => {
  it('teléfono: se limpian separadores; 7 a 15 dígitos con + opcional', () => {
    expect(normalizePhone('(300) 123-45.67')).toBe('3001234567');
    expect(PUBLIC_PHONE.test('3001234567')).toBe(true);
    expect(PUBLIC_PHONE.test('+573001234567')).toBe(true);
    expect(PUBLIC_PHONE.test('123456')).toBe(false);
    expect(PUBLIC_PHONE.test('30012ab567')).toBe(false);
    expect(phoneDigits('+57 300 123')).toBe('57300123');
  });

  it('"cualquiera": menos citas ese día primero, luego nombre e id', () => {
    const order = orderForAnyProfessional([
      { id: 'b', name: 'Laura', load: 1 },
      { id: 'c', name: 'Ana', load: 1 },
      { id: 'a', name: 'Ana', load: 1 },
      { id: 'd', name: 'Zoe', load: 0 },
    ]).map((p) => p.id);
    expect(order).toEqual(['d', 'a', 'c', 'b']);
  });

  it('unión ordenada y sin repetir de horas libres', () => {
    const at = (h: number) => new Date(Date.UTC(2031, 2, 3, h));
    expect(unionOfStarts([[at(10), at(9)], [at(9), at(11)], []])).toEqual([
      at(9),
      at(10),
      at(11),
    ]);
  });

  it('DTO: cliente obligatorio con nombre de letras; campos desconocidos los rechaza el pipe global', async () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(CreatePublicBookingDto, body))).map(
        (e) => e.property,
      );
    const ok = {
      service_ids: ['c0000000-0000-4000-8000-000000000002'],
      start: '2031-03-03T09:00:00',
      client: { name: 'María José', phone: '300 123 4567' },
    };
    expect(await errors(ok)).toEqual([]);
    expect(
      await errors({ ...ok, client: { name: 'X1', phone: '3001234567' } }),
    ).toEqual(['client']);
    expect(await errors({ ...ok, service_ids: [] })).toEqual(['service_ids']);
  });
});
