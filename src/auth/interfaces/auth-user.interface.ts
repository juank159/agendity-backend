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
