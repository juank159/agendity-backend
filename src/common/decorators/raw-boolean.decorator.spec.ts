import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage } from 'class-validator';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { TransformationType } from 'class-transformer';
import { RAW_BOOLEAN_TRANSFORM } from './raw-boolean.decorator';
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

/** Todos los `.ts` de `src` (sin specs). */
function sources(dir = join(__dirname, '..', '..')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/**
 * Guardia (auditoría del 2026-11-01): todo booleano de ENTRADA lleva
 * `@RawBoolean()`. Si falla, añade `@RawBoolean()` encima de `@IsBoolean()`
 * (o, en la query, usa `ParseBoolPipe`).
 */
describe('guardia: ningún booleano de entrada sin @RawBoolean', () => {
  const dtoFiles = sources().filter(
    (f) => /\/dto\//.test(f) || f.endsWith('.dto.ts'),
  );

  it('cada propiedad booleana validada de cada DTO usa @RawBoolean', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of dtoFiles) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(file);
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function') continue;
        const cls = value as new () => object;
        const metas = getMetadataStorage().getTargetValidationMetadatas(
          cls,
          '',
          true,
          false,
        );
        const props = new Set(metas.map((m) => m.propertyName));
        for (const prop of props) {
          const isBool =
            metas.some(
              (m) => m.propertyName === prop && m.name === 'isBoolean',
            ) ||
            Reflect.getMetadata('design:type', cls.prototype, prop) === Boolean;
          if (!isBool) continue;
          checked++;
          const transforms = defaultMetadataStorage.findTransformMetadatas(
            cls,
            prop,
            TransformationType.PLAIN_TO_CLASS,
          );
          if (
            !transforms.some((t) => t.transformFn === RAW_BOOLEAN_TRANSFORM)
          ) {
            missing.push(`${cls.name}.${prop} (${file.split('/src/')[1]})`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  it('en los controllers, ningún booleano de query a mano (=== "true") ni sin ParseBoolPipe', () => {
    const offenders = sources()
      .filter((f) => f.endsWith('.controller.ts'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        const bad = [
          ...text.matchAll(/=== ?['"](true|false)['"]/g),
          ...text.matchAll(/@Query\('[^']+'\)\s*\w+\??:\s*boolean/g),
        ];
        return bad.map((m) => `${file.split('/src/')[1]}: ${m[0]}`);
      });
    expect(offenders).toEqual([]);
  });
});
