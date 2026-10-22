/**
 * Datos reales de la BD de desarrollo para los e2e, en SOLO LECTURA,
 * y tokens firmados con el secreto del `.env` (sin pasar por el login).
 */
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { User } from '../../src/users/entities/user.entity';

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
  const employee = await repo.findOne({
    where: { owner: { id: owner.id } },
  });
  return { owner, employee };
}

/** Firma un JWT como lo hace `AuthService.generateToken`, con los roles indicados. */
export function signToken(
  user: Pick<User, 'id' | 'name' | 'email' | 'tenant_id'>,
  roles: string[],
): string {
  const jwt = new JwtService({ secret: process.env.SECRET_KEY_JWT });
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      roles,
      tenant_id: user.tenant_id,
    },
    { expiresIn: '5m' },
  );
}
