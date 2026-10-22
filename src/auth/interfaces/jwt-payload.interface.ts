/**
 * Claims del JWT que firma `AuthService.generateToken`.
 * `tenantId`/`ownerId` existen desde 2.01: los tokens anteriores no los traen y
 * `JwtStrategy` los resuelve en la BD (transición; los JWT duran 1 día).
 */
export interface JwtPayload {
  id: string;
  name: string;
  email: string;
  roles?: string[];
  tenantId?: string;
  ownerId?: string;
  /**
   * Igual a `tenantId`. Solo por compatibilidad: la app lo decodifica y lo manda
   * en `POST /subscriptions/subscribe` (el DTO exige un UUID). Quitar en 3.02.
   */
  tenant_id?: string;
}
