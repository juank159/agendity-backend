import { NotFoundException } from '@nestjs/common';
import { EntityManager, EntityTarget, In, ObjectLiteral } from 'typeorm';

/**
 * Regla común (auditoría 2026-11-01): toda clave que llega del cliente
 * (body, ruta, query o payload de sync) y apunta a OTRA fila debe comprobarse
 * contra el negocio ANTES de escribir. Esta función lo hace para listas de
 * ids: todos deben existir en el negocio (`tenantColumn`, por defecto
 * `ownerId`); si alguno no, 404 (igual que si no existiera), sin decir de
 * quién es. Para ids nuevos que da la app, ver `assertClientIdFree`.
 */
export async function assertTenantRefs<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  ids: readonly string[],
  tenantId: string,
  options: { tenantColumn?: string; message?: string } = {},
): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  if (!tenantId)
    throw new NotFoundException(options.message ?? 'No encontrado');
  const found = await manager.getRepository(entity).count({
    where: {
      id: In(unique),
      [options.tenantColumn ?? 'ownerId']: tenantId,
    } as never,
  });
  if (found !== unique.length) {
    throw new NotFoundException(
      options.message ?? 'Uno o más registros no encontrados',
    );
  }
}
