/**
 * Datos reales de la BD de desarrollo para los e2e, en SOLO LECTURA,
 * y tokens firmados con el secreto del `.env` (sin pasar por el login).
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { JwtStrategy } from '../../src/auth/jwt/jwt.strategy';
import { User } from '../../src/users/entities/user.entity';
import { JwtPayload, tenantOf } from '../../src/auth/interfaces';

export interface DevUsers {
  owner: User;
  /** Un empleado del owner, si existe en la BD de desarrollo. */
  employee: User | null;
}

/** El Owner más antiguo de la BD y uno de sus empleados. */
export async function findDevOwnerAndEmployee(
  ds: DataSource,
): Promise<DevUsers> {
  const repo = ds.getRepository(User);
  const owner = await repo
    .createQueryBuilder('user')
    .innerJoin('user.roles', 'role', 'role.name = :role', { role: 'Owner' })
    .orderBy('user.created_at', 'ASC')
    .getOne();
  if (!owner) {
    throw new Error('La BD de desarrollo no tiene ningún Owner');
  }
  // El más antiguo: los e2e que escriben crean empleados nuevos en la copia.
  const employee = await repo.findOne({
    where: { owner: { id: owner.id } },
    relations: ['owner'],
    order: { created_at: 'ASC' },
  });
  return { owner, employee };
}

/**
 * Firma un JWT como lo hace `AuthService.generateToken` (payload de 2.01, con
 * `tenantId`/`ownerId`), con los roles indicados. El tenant sale de `owner`
 * si viene cargado; si no, es el propio id (Owner o usuario ficticio).
 */
export function signToken(
  user: Pick<User, 'id' | 'name' | 'email'> & { owner?: { id: string } | null },
  roles: string[],
): string {
  const jwt = new JwtService({ secret: process.env.SECRET_KEY_JWT });
  const tenantId = tenantOf(user);
  const payload: JwtPayload = {
    id: user.id,
    name: user.name,
    email: user.email,
    roles,
    tenantId,
    ownerId: tenantId,
    tenant_id: tenantId,
  };
  return jwt.sign(payload, { expiresIn: '5m' });
}

/**
 * Desde 2.12 `JwtStrategy` comprueba en la BD cada cuenta del token. Los specs
 * de solo lectura usan Owners FICTICIOS (ids que no existen) para probar el
 * aislamiento: esta función hace que esos ids cuenten como un Owner activo sin
 * escribir nada. Parchea la instancia (no es un `jest.spyOn`), así que sobrevive
 * a `jest.restoreAllMocks()`. `ids` se puede ampliar después de llamarla.
 */
export function allowFictitiousAccounts(
  app: INestApplication,
  ids: string[],
): void {
  const strategy = app.get(JwtStrategy);
  const real = JwtStrategy.prototype.loadAccount.bind(strategy);
  strategy.loadAccount = async (id: string) =>
    ids.includes(id)
      ? ({
          id,
          isActive: true,
          deletedAt: null,
          owner: null,
          roles: [{ name: 'Owner' }],
        } as unknown as User)
      : real(id);
}
