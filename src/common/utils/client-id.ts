import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../constants/error-codes';

/**
 * Ids generados por la app (10.01b, D-18): las rutas de crear aceptan un `id`
 * (UUID). Si ya existe (en este negocio o en otro) → 409 `CONFLICT`, sin decir
 * de quién es. Importante: sin esta comprobación, `save()` de TypeORM con un
 * id existente ACTUALIZARÍA esa fila.
 */
export async function assertClientIdFree<T extends ObjectLiteral>(
  manager: EntityManager,
  entity: EntityTarget<T>,
  id: string | undefined | null,
): Promise<void> {
  if (!id) return;
  const exists = await manager
    .getRepository(entity)
    .exist({ where: { id } as never, withDeleted: true });
  if (exists) {
    throw new BusinessException(
      ErrorCode.CONFLICT,
      'Ya existe un registro con ese id',
    );
  }
}
