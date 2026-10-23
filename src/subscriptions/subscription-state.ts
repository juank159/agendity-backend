import { ErrorCode } from 'src/common/constants/error-codes';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { addBusinessMonths } from 'src/common/utils/date.util';

/**
 * Reglas puras de la suscripción de un negocio (tarea 2.03). Sin BD ni Nest:
 * las usan las lecturas (`status`, `check-limits`) y el consumo atómico que
 * hace la creación de citas, para que ambos digan exactamente lo mismo.
 */

/** Citas del periodo de prueba de un negocio nuevo. */
export const TRIAL_APPOINTMENTS_LIMIT = 20;

/** `subscription_plans.appointment_limit = -1` = citas ilimitadas. */
export const UNLIMITED_APPOINTMENTS = -1;

export const SubscriptionStatus = {
  TRIAL: 'trial',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
} as const;

/**
 * Textos que ve el usuario. La app compara algunos ('límite de citas',
 * 'adquiere un plan', 'suscripción no está activa', 'actualiza tu plan'):
 * no cambiarlos hasta que decida por `code` (D-11, tarea 4.05).
 */
export const SUBSCRIPTION_MESSAGES = {
  trialRemaining: (n: number) => `Citas restantes en prueba: ${n}`,
  trialLimitReached:
    'Has alcanzado el límite de citas de prueba. Por favor, adquiere un plan para continuar.',
  expired: 'Tu suscripción ha expirado. Por favor, renueva tu plan.',
  unlimited: 'Plan activo con citas ilimitadas',
  planRemaining: (n: number) => `Citas restantes en tu plan: ${n}`,
  planLimitReached: 'Has alcanzado el límite de citas de tu plan actual.',
  inactive: 'Tu suscripción no está activa. Por favor, actualiza tu plan.',
  checkFailed: 'Error al verificar estado de suscripción.',
} as const;

/** Respuesta de `GET /subscriptions/check-limits` (forma de siempre). */
export interface AppointmentAllowance {
  canCreateAppointment: boolean;
  message?: string;
  /** Por qué no se puede crear la cita (contrato §3). */
  code?: ErrorCode;
}

type SubscriptionLike = Pick<
  Subscription,
  | 'status'
  | 'subscription_end_date'
  | 'trial_appointments_used'
  | 'trial_appointments_limit'
> & { plan?: Pick<SubscriptionPlan, 'appointment_limit'> | null };

/**
 * Estados de un intento de pago de plan (`payment_history.status`). Desde 2.15
 * pedir un enlace de pago crea un intento `pending` y NO toca la suscripción:
 * el negocio sigue en su estado (p. ej. trial) hasta que Wompi confirma.
 */
export const PaymentAttemptStatus = {
  PENDING: 'pending',
  SUCCESSFUL: 'successful',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

/**
 * Regla del usuario (2.15): cancelar un plan pagado lo deja vigente hasta
 * `subscription_end_date` y no se renueva. La fila queda `canceled` (el hecho)
 * con la fecha de fin; mientras no llegue, el estado efectivo es `active`
 * (la app solo deja agendar con `active`) y la vista lo marca con
 * `cancel_at_period_end`. Después de la fecha: `canceled`.
 */
export function isCanceledButCurrent(
  subscription: SubscriptionLike | null,
  now: Date = new Date(),
): boolean {
  return (
    subscription?.status === SubscriptionStatus.CANCELED &&
    !!subscription.plan &&
    !!subscription.subscription_end_date &&
    new Date(subscription.subscription_end_date).getTime() > now.getTime()
  );
}

/**
 * Estado efectivo en `now`. No escribe: una suscripción `active` cuya fecha de
 * fin ya pasó se informa como `expired` aunque la fila diga `active` (la fila
 * la actualiza el cron `expireOverdueSubscriptions`). Sin fila = trial sin usar.
 * Cancelada pero vigente (`isCanceledButCurrent`) = `active` hasta la fecha de
 * fin; para distinguirla usa `cancelAtPeriodEnd` / `isCanceledButCurrent`.
 */
export function effectiveStatus(
  subscription: SubscriptionLike | null,
  now: Date = new Date(),
): string {
  if (!subscription) return SubscriptionStatus.TRIAL;
  if (isCanceledButCurrent(subscription, now)) return SubscriptionStatus.ACTIVE;
  if (
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.subscription_end_date &&
    new Date(subscription.subscription_end_date).getTime() < now.getTime()
  ) {
    return SubscriptionStatus.EXPIRED;
  }
  return subscription.status;
}

/**
 * Límite de citas del plan pagado vigente, o `null` si no aplica (no es un plan
 * activo, no tiene plan o es ilimitado). Si devuelve un número, el llamador debe
 * contar las citas del periodo y pasarlas a `appointmentAllowance`.
 */
export function paidPlanLimit(
  subscription: SubscriptionLike | null,
  now: Date = new Date(),
): number | null {
  if (
    !subscription?.plan ||
    effectiveStatus(subscription, now) !== SubscriptionStatus.ACTIVE
  ) {
    return null;
  }
  const limit = Number(subscription.plan.appointment_limit);
  return limit === UNLIMITED_APPOINTMENTS ? null : limit;
}

/**
 * ¿Puede el negocio crear una cita ahora? Misma regla para la lectura y para el
 * consumo. `appointmentsInPeriod` solo cuenta en planes pagados con límite.
 */
export function appointmentAllowance(
  subscription: SubscriptionLike | null,
  now: Date = new Date(),
  appointmentsInPeriod = 0,
): AppointmentAllowance {
  const status = effectiveStatus(subscription, now);

  if (status === SubscriptionStatus.TRIAL) {
    const used = subscription?.trial_appointments_used ?? 0;
    const limit =
      subscription?.trial_appointments_limit ?? TRIAL_APPOINTMENTS_LIMIT;
    if (used < limit) {
      return {
        canCreateAppointment: true,
        message: SUBSCRIPTION_MESSAGES.trialRemaining(limit - used),
      };
    }
    return {
      canCreateAppointment: false,
      code: ErrorCode.TRIAL_LIMIT_REACHED,
      message: SUBSCRIPTION_MESSAGES.trialLimitReached,
    };
  }

  if (status === SubscriptionStatus.EXPIRED && subscription?.plan) {
    return {
      canCreateAppointment: false,
      code: ErrorCode.SUBSCRIPTION_INACTIVE,
      message: SUBSCRIPTION_MESSAGES.expired,
    };
  }

  if (status === SubscriptionStatus.ACTIVE && subscription?.plan) {
    const limit = paidPlanLimit(subscription, now);
    if (limit === null) {
      return {
        canCreateAppointment: true,
        message: SUBSCRIPTION_MESSAGES.unlimited,
      };
    }
    if (appointmentsInPeriod < limit) {
      return {
        canCreateAppointment: true,
        message: SUBSCRIPTION_MESSAGES.planRemaining(
          limit - appointmentsInPeriod,
        ),
      };
    }
    return {
      canCreateAppointment: false,
      code: ErrorCode.SUBSCRIPTION_INACTIVE,
      message: SUBSCRIPTION_MESSAGES.planLimitReached,
    };
  }

  // past_due, canceled (ya sin periodo), expired sin plan o active sin plan.
  return {
    canCreateAppointment: false,
    code: ErrorCode.SUBSCRIPTION_INACTIVE,
    message: SUBSCRIPTION_MESSAGES.inactive,
  };
}

/**
 * Fin del periodo pagado: `start + plan.duration_months` en el calendario del
 * negocio (antes se deducía del nombre del plan). Una duración inválida cuenta
 * como 1 mes.
 */
export function planPeriodEnd(
  start: Date,
  plan: Pick<SubscriptionPlan, 'duration_months'>,
): Date {
  const months = Number(plan.duration_months);
  return addBusinessMonths(
    start,
    Number.isInteger(months) && months >= 1 ? months : 1,
  );
}
