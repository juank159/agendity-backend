import { AppointmentStatus } from 'src/common/enums/status.enum';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';

/**
 * Máquina de estados de la cita (2.06). ÚNICO sitio que decide qué cambios de
 * `status` son válidos; la usan el PATCH genérico, cancelar, completar y pagos.
 *
 *   PENDING ──► CONFIRMED ──► COMPLETED
 *      │  │         │              ▲
 *      │  └─────────┼──────────────┘   (completar sin pagar, 2.15: se paga después)
 *      └────────────┴──► CANCELLED     (si no tiene un pago COMPLETED, 2.15)
 *
 * COMPLETED y CANCELLED son finales. Pedir el mismo estado en el que ya está
 * la cita no es una transición: no cambia nada y no es error (reintentos).
 */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  [AppointmentStatus.PENDING]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.CANCELLED]: [],
};

export const STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  [AppointmentStatus.PENDING]: 'pendiente',
  [AppointmentStatus.CONFIRMED]: 'confirmada',
  [AppointmentStatus.COMPLETED]: 'completada',
  [AppointmentStatus.CANCELLED]: 'cancelada',
};

export function isFinalStatus(status: AppointmentStatus): boolean {
  return (APPOINTMENT_TRANSITIONS[status] ?? []).length === 0;
}

/** ¿Se puede pasar de `from` a `to`? (mismo estado = no es una transición: false). */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return (APPOINTMENT_TRANSITIONS[from] ?? []).includes(to);
}

export function invalidTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): BusinessException {
  return new BusinessException(
    ErrorCode.INVALID_STATE_TRANSITION,
    `No se puede pasar una cita ${STATUS_LABELS[from] ?? from} a ${
      STATUS_LABELS[to] ?? to
    }`,
  );
}

/**
 * Valida el cambio de `from` a `to` y dice si hay que escribir algo:
 * `true` = transición válida; `false` = ya estaba en `to` (no-op).
 * Lanza `INVALID_STATE_TRANSITION` (409) si no está permitida.
 */
export function assertTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  if (from === to) return false;
  if (!canTransition(from, to)) throw invalidTransition(from, to);
  return true;
}

/**
 * Estado de la cita al registrar un pago: una cita PENDING pasa a CONFIRMED;
 * CONFIRMED y COMPLETED se quedan como están (se puede pagar después de
 * atender); una cita CANCELLED no admite pagos (`INVALID_STATE_TRANSITION`).
 */
export function statusAfterPayment(
  current: AppointmentStatus,
): AppointmentStatus {
  if (current === AppointmentStatus.CANCELLED) {
    throw new BusinessException(
      ErrorCode.INVALID_STATE_TRANSITION,
      'No se puede registrar un pago en una cita cancelada',
    );
  }
  return current === AppointmentStatus.PENDING
    ? AppointmentStatus.CONFIRMED
    : current;
}

/**
 * Regla del usuario (2.15): una cita con un pago COMPLETED (no reembolsado del
 * todo; el reembolso total lo pasa a REFUNDED) no se cancela hasta reembolsarlo.
 */
export function assertCancellable(hasCompletedPayment: boolean): void {
  if (hasCompletedPayment) {
    throw new BusinessException(
      ErrorCode.APPOINTMENT_PAID,
      'La cita tiene un pago registrado: reembólsalo por completo antes de cancelarla',
    );
  }
}
