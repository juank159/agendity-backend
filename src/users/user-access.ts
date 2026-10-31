import { NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { FindOptionsWhere, Repository } from 'typeorm';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { User } from './entities/user.entity';

/** Quién hace la petición (lo que deja `JwtStrategy` en `req.user`). */
export interface UserAccessActor {
  id: string;
  roles?: string[];
}

export interface UserAccessOptions {
  /** Solo empleados del actor (excluye actuar sobre uno mismo). */
  employeesOnly?: boolean;
}

/**
 * Regla única de acceso a usuarios: un usuario puede gestionarse a sí mismo y un
 * Owner puede gestionar a sus empleados (`users.owner`). En cualquier otro caso
 * responde 404 para no revelar que el usuario existe.
 *
 * No depende de inyección para poder usarse desde `UsersService` y `AuthService`
 * sin crear dependencias circulares entre módulos.
 *
 * @returns el usuario objetivo con la relación `owner` cargada.
 */
export async function assertCanManageUser(
  repository: Repository<User>,
  actor: UserAccessActor,
  target: { id?: string; email?: string },
  options: UserAccessOptions = {},
): Promise<User> {
  const notFound = () => new NotFoundException('Usuario no encontrado');

  let where: FindOptionsWhere<User>;
  if (target.id !== undefined) {
    if (!isUUID(target.id)) throw notFound();
    where = { id: target.id };
  } else if (target.email) {
    where = { email: target.email };
  } else {
    throw notFound();
  }

  if (!actor?.id) throw notFound();

  const user = await repository.findOne({ where, relations: ['owner'] });
  if (!user) throw notFound();

  const isSelf = user.id === actor.id;
  const isOwnEmployee =
    !!actor.roles?.includes(JwtRoles.Owner) && user.owner?.id === actor.id;

  const allowed = options.employeesOnly
    ? isOwnEmployee
    : isSelf || isOwnEmployee;
  if (!allowed) throw notFound();

  return user;
}

/**
 * Usuarios de un negocio: el Owner (`id = tenantId`) y sus empleados
 * (`users.owner = tenantId`). Es un OR para `find*`; en una relación se usa así:
 * `where: tenantMembersWhere(t).map((user) => ({ id, user }))`.
 */
export function tenantMembersWhere(tenantId: string): FindOptionsWhere<User>[] {
  // TypeORM ignora `{ id: undefined }`: sin tenant devolvería usuarios de todos.
  if (!tenantId) throw new NotFoundException('Profesional no encontrado');
  return [{ id: tenantId }, { owner: { id: tenantId } }];
}

/**
 * Un usuario (profesional) del negocio indicado o 404. Sirve para validar los
 * `professional_id`/`user_id` que llegan en las peticiones.
 */
export async function assertUserInTenant(
  repository: Repository<User>,
  tenantId: string,
  userId: string,
): Promise<User> {
  const notFound = () => new NotFoundException('Profesional no encontrado');
  if (!tenantId || !userId || !isUUID(userId)) throw notFound();
  if (userId === tenantId) {
    const owner = await repository.findOne({ where: { id: userId } });
    if (!owner) throw notFound();
    return owner;
  }
  const user = await repository.findOne({
    where: { id: userId, owner: { id: tenantId } },
  });
  if (!user) throw notFound();
  return user;
}

/**
 * ¿Se le pueden agendar citas a este profesional del negocio `tenantId`?
 * (2.33, regla ÚNICA: la usan crear/mover una cita, los huecos libres y
 * `GET /auth/employees/active`). Activo, sin borrar y, si es empleado, con el
 * email verificado (2.15/2.16: un empleado sin verificar no se activa). El
 * Owner (`id === tenantId`) puede tener el email sin verificar.
 */
export function canBeScheduled(
  user: {
    id: string;
    isActive?: boolean;
    deletedAt?: Date | null;
    is_email_verified?: boolean;
  } | null,
  tenantId: string,
): boolean {
  if (!user?.isActive || user.deletedAt) return false;
  return user.id === tenantId || user.is_email_verified === true;
}

/**
 * Lecturas de la agenda de un profesional (horarios, servicios asignados):
 * una empleada solo ve las suyas (2026-10-31). `ownProfessionalId` = id de la
 * empleada que llama (`undefined` para el Owner). Ajena → 404, como cualquier
 * recurso que no es tuyo.
 */
export function assertOwnProfessional(
  ownProfessionalId: string | undefined,
  professionalId: string,
  message = 'Usuario no encontrado',
): void {
  if (ownProfessionalId && ownProfessionalId !== professionalId) {
    throw new NotFoundException(message);
  }
}
