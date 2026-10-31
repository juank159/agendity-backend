import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateClientDto } from 'src/clients/dto/create-client.dto';
import { CreatePublicBookingDto } from 'src/public-booking/dto/public-booking.dto';

/** D-21: el consentimiento nunca se da por una conversión implícita ("false" → true). */
describe('@RawBoolean: consentimiento de WhatsApp sin conversión implícita', () => {
  const check = (cls: any, base: object, value: unknown) => {
    const dto = plainToInstance(
      cls,
      { ...base, whatsapp_opt_in: value },
      { enableImplicitConversion: true },
    );
    return {
      value: (dto as any).whatsapp_opt_in,
      errors: validateSync(dto as object, { whitelist: true }).filter(
        (e) => e.property === 'whatsapp_opt_in',
      ).length,
    };
  };
  const client = { name: 'Ana', lastname: 'Pérez', phone: '3001234567' };
  const booking = {
    service_ids: ['595331e0-b7e9-48e2-9ca8-8a5e4cdf18f4'],
    start: '2031-03-03T09:00:00',
    client,
  };

  it.each([
    [CreateClientDto, client],
    [CreatePublicBookingDto, booking],
  ])('%p: true/false de JSON valen; cadenas y objetos no', (cls, base) => {
    expect(check(cls, base, true)).toEqual({ value: true, errors: 0 });
    expect(check(cls, base, false)).toEqual({ value: false, errors: 0 });
    expect(check(cls, base, undefined).errors).toBe(0);
    for (const bad of ['false', 'true', 'si', 1, {}]) {
      expect(check(cls, base, bad).errors).toBe(1);
    }
  });
});
