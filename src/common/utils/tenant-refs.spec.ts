import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getMetadataStorage } from 'class-validator';
import { NotFoundException } from '@nestjs/common';
import { assertTenantRefs } from './tenant-refs';

/**
 * Auditoría 2026-11-01 (ids del cliente que pisan filas de otro negocio). Estas
 * pruebas hacen difícil repetir el patrón: si un DTO nuevo acepta `id`, o un
 * DTO de PATCH lo hereda, fallan y obligan a revisar la ruta.
 */
const SRC = join(__dirname, '..', '..');

function dtoFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return dtoFiles(path);
    return /\/dto\/[^/]+\.dto\.ts$/.test(path) ? [path] : [];
  });
}

/** DTOs que aceptan `id` del cliente; su service DEBE llamar a `assertClientIdFree`. */
const DTOS_WITH_CLIENT_ID = [
  'appointments/dto/create-appointment.dto.ts',
  'categories/dto/create-category.dto.ts',
  'clients/dto/create-client.dto.ts',
  'payments/dto/create-payment.dto.ts',
  'services/dto/create-service.dto.ts',
  'time-blocks/dto/create-time-block.dto.ts',
];

describe('ids que llegan del cliente (auditoría 2026-11-01)', () => {
  const files = dtoFiles(SRC);

  it('solo los DTO revisados aceptan `id` (uno nuevo obliga a revisar su ruta)', () => {
    const withId = files
      .filter((file) =>
        /^\s+id\??:\s*string;/m.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(SRC, file))
      .filter((file) => !/response\.dto|find-category|create-static/.test(file))
      .sort();
    expect(withId).toEqual(DTOS_WITH_CLIENT_ID);
  });

  it('cada service de esos DTO comprueba el id con assertClientIdFree', () => {
    for (const dto of DTOS_WITH_CLIENT_ID) {
      const module = dto.split('/')[0];
      const sources = readdirSync(join(SRC, module))
        .filter((name) => name.endsWith('.service.ts'))
        .map((name) => readFileSync(join(SRC, module, name), 'utf8'))
        .join('\n');
      expect([module, sources.includes('assertClientIdFree(')]).toEqual([
        module,
        true,
      ]);
    }
  });

  it('ningún DTO de PATCH (Update*) acepta `id`', () => {
    for (const file of files.filter((f) =>
      /\/update-[^/]+\.dto\.ts$/.test(f),
    )) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const exported = require(file);
      for (const cls of Object.values(exported)) {
        if (typeof cls !== 'function') continue;
        const props = getMetadataStorage()
          .getTargetValidationMetadatas(cls as any, '', true, false)
          .map((m) => m.propertyName);
        expect([relative(SRC, file), props.includes('id')]).toEqual([
          relative(SRC, file),
          false,
        ]);
      }
    }
  });
});

describe('assertTenantRefs', () => {
  const manager = (count: number) =>
    ({ getRepository: () => ({ count: jest.fn(async () => count) }) }) as any;

  it('todos del negocio: pasa; alguno ajeno o inexistente: 404', async () => {
    await expect(
      assertTenantRefs(manager(2), class {}, ['a', 'b', 'a'], 't1'),
    ).resolves.toBeUndefined();
    await expect(
      assertTenantRefs(manager(1), class {}, ['a', 'b'], 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      assertTenantRefs(manager(0), class {}, [], 't1'),
    ).resolves.toBeUndefined();
  });
});
