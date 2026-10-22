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
