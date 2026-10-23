import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-codes';
import { JwtRoles } from './jwt/jwt.role';

/**
 * Regla única de acceso de una cuenta (2.12). La usan el login (email y
 * Google) y `JwtStrategy` en cada petición:
 * - borrada (soft-delete) → sin acceso;
 * - Employee sin negocio (su owner no existe, está borrado o inactivo) → sin
 *   acceso (antes quedaba como su propio tenant, vacío);
 * - `isActive = false` → sin acceso; si además no verificó el email, el motivo
 *   es la verificación pendiente (la completa el Owner, 2.16).
 * El email sin verificar de un Owner NO bloquea (regla vigente; ver PLAN 2.12).
 */
export type AccountBlock =
  | 'DELETED'
  | 'NO_BUSINESS'
  | 'NOT_VERIFIED'
  | 'DEACTIVATED';

export interface AccountState {
  isActive?: boolean;
  deletedAt?: Date | null;
  is_email_verified?: boolean;
  roles?: Array<{ name: string }> | null;
  owner?: { isActive?: boolean; deletedAt?: Date | null } | null;
}

/**
 * Textos para quien intenta entrar. No usan "email", "correo", "contraseña" ni
 * "credenciales": `login_controller.dart` los compara para marcar campos.
 */
export const ACCOUNT_BLOCK_MESSAGES: Record<AccountBlock, string> = {
  DELETED: 'Tu cuenta fue dada de baja. Contacta al administrador del negocio.',
  NO_BUSINESS:
    'Tu cuenta no pertenece a ningún negocio activo. Contacta al administrador.',
  NOT_VERIFIED:
    'Tu cuenta aún no está activa: el administrador del negocio debe completar su verificación.',
  DEACTIVATED:
    'Tu cuenta está desactivada. Contacta al administrador del negocio.',
};

function isOnlyEmployeeAccount(user: AccountState): boolean {
  const names = (user.roles ?? []).map((role) => role.name);
  return (
    names.includes(JwtRoles.Employee) &&
    !names.includes(JwtRoles.Owner) &&
    !names.includes(JwtRoles.Admin)
  );
}

export function accountBlock(user: AccountState): AccountBlock | null {
  if (user.deletedAt) return 'DELETED';
  if (isOnlyEmployeeAccount(user)) {
    const owner = user.owner;
    if (!owner || owner.deletedAt || owner.isActive === false) {
      return 'NO_BUSINESS';
    }
  }
  if (user.isActive === false) {
    return user.is_email_verified === true ? 'DEACTIVATED' : 'NOT_VERIFIED';
  }
  return null;
}

/** Login: `ACCOUNT_INACTIVE` (403) con el motivo en el texto. */
export function assertAccountCanLogin(user: AccountState): void {
  const block = accountBlock(user);
  if (block) {
    throw new BusinessException(
      ErrorCode.ACCOUNT_INACTIVE,
      ACCOUNT_BLOCK_MESSAGES[block],
    );
  }
}
