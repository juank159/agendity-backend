import { JwtRoles } from '../jwt/jwt.role';

/**
 * Usuario autenticado (lo que `JwtStrategy.validate` deja en `req.user` y
 * devuelve `@CurrentUser()`).
 *
 * El tenant es el negocio, identificado por el id del Owner:
 * - Owner (y Admin): `tenantId = ownerId = id`.
 * - Employee: `tenantId = ownerId = id de su owner` (`users.owner`).
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  tenantId: string;
  ownerId: string;
}

/** Regla única del tenant de un usuario: el id de su owner o, si no tiene, el suyo. */
export function tenantOf(user: {
  id: string;
  owner?: { id: string } | null;
}): string {
  return user.owner?.id ?? user.id;
}

/**
 * Empleado que no es además Owner. A estos usuarios se les limita a "sus" datos
 * dentro del tenant (por ejemplo, solo ven las citas donde son el profesional).
 */
export function isOnlyEmployee(user: Pick<AuthUser, 'roles'>): boolean {
  const roles = user?.roles ?? [];
  return roles.includes(JwtRoles.Employee) && !roles.includes(JwtRoles.Owner);
}
