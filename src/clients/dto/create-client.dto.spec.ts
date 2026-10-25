import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClientDto } from './create-client.dto';
import { UpdateClientDto } from './update-client.dto';

const base = { name: 'Ana', lastname: 'Pérez', phone: '3001234567' };

async function check(cls: any, body: object) {
  const dto = plainToInstance(cls, body) as any;
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property) };
}

describe('email del cliente opcional (2.20)', () => {
  it.each([CreateClientDto, UpdateClientDto])(
    "%p: '' o espacios (lo que envía la app sin email) → null, válido",
    async (cls) => {
      for (const email of ['', '   ']) {
        const { dto, fields } = await check(cls, { ...base, email });
        expect(fields).toEqual([]);
        expect(dto.email).toBeNull();
      }
    },
  );

  it('sin email o null: válido; un email mal escrito sigue siendo 400', async () => {
    expect((await check(CreateClientDto, base)).fields).toEqual([]);
    expect(
      (await check(CreateClientDto, { ...base, email: null })).fields,
    ).toEqual([]);
    expect(
      (await check(CreateClientDto, { ...base, email: 'no-es-email' })).fields,
    ).toEqual(['email']);
    const ok = await check(CreateClientDto, { ...base, email: 'a@b.co' });
    expect([ok.fields, ok.dto.email]).toEqual([[], 'a@b.co']);
  });
});
