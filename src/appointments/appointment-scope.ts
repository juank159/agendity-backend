import { AuthUser, isOnlyEmployee } from 'src/auth/interfaces';
import { tenantIdFrom } from 'src/common/decorators/tenant.decorator';

/**
 * Qué citas puede ver quien llama: las del negocio (`ownerId = tenantId`) y,
 * si es un Employee que no es Owner, solo aquellas donde es el profesional.
 */
export interface AppointmentScope {
  tenantId: string;
  professionalId?: string;
}

export function appointmentScopeOf(user: AuthUser): AppointmentScope {
  const tenantId = tenantIdFrom(user);
  return isOnlyEmployee(user)
    ? { tenantId, professionalId: user.id }
    : { tenantId };
}

/** Acepta un tenant suelto (llamadas internas de otros módulos) o un alcance. */
export function toAppointmentScope(
  scope: AppointmentScope | string,
): AppointmentScope {
  return typeof scope === 'string' ? { tenantId: scope } : scope;
}
