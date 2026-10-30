import { BadRequestException, ParseArrayPipe } from '@nestjs/common';
import { AssignServiceDto } from './assign-service.dto';

/** 7.03 (c): el batch valida cada elemento (antes aceptó 150 % de comisión). */
describe('POST /users/:userId/services/batch: validación del cuerpo (7.03)', () => {
  const pipe = new ParseArrayPipe({
    items: AssignServiceDto,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const SERVICE = 'c0000000-0000-4000-8000-000000000002';
  const parse = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: Array } as any);
  const messagesOf = async (body: unknown) => {
    const error = await parse(body).catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    return JSON.stringify(error.getResponse());
  };

  it('comisión de 150 %, negativa, precio negativo o servicio inválido: 400 en español', async () => {
    expect(
      await messagesOf([{ serviceId: SERVICE, commissionPercentage: 150 }]),
    ).toContain('La comisión no puede ser mayor que 100 %');
    expect(
      await messagesOf([{ serviceId: SERVICE, commissionPercentage: -1 }]),
    ).toContain('La comisión no puede ser menor que 0 %');
    expect(
      await messagesOf([{ serviceId: SERVICE, customPrice: -5 }]),
    ).toContain('El precio personalizado no puede ser negativo');
    expect(await messagesOf([{ serviceId: 'x' }])).toContain(
      'El servicio no es válido',
    );
    expect(await messagesOf([{ serviceId: SERVICE, extra: 1 }])).toContain(
      'extra',
    );
  });

  it('válido: pasa', async () => {
    await expect(
      parse([
        { serviceId: SERVICE, commissionPercentage: 30, customPrice: 25000 },
      ]),
    ).resolves.toHaveLength(1);
  });
});
