import { PaymentStatus } from 'src/common/enums/status.enum';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';

/**
 * Reglas puras de importes de pagos (2.06). Todo en centavos enteros para no
 * comparar decimales en coma flotante (Postgres devuelve `numeric` como string).
 */

/** Importe (number o string decimal de Postgres) → centavos enteros. */
export function toCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Importe neto de un pago: lo cobrado menos lo reembolsado. */
export function netPaidCents(payment: {
  amount: number | string;
  refund_amount?: number | string | null;
}): number {
  return toCents(payment.amount) - toCents(payment.refund_amount);
}

/** SQL gemelo de `netPaidCents` (en pesos) para las estadísticas. */
export function netAmountSql(alias: string): string {
  return `(${alias}.amount - COALESCE(${alias}.refund_amount, 0))`;
}

/**
 * Monto de un pago nuevo: > 0 y sin pasar del total de la cita (no hay otro
 * pago COMPLETED: lo garantiza la regla de un único pago por cita).
 */
export function assertPaymentAmount(
  amount: number,
  appointmentTotal: number | string,
): void {
  const cents = toCents(amount);
  if (!(cents > 0)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'El monto del pago debe ser mayor que cero',
    );
  }
  if (cents > toCents(appointmentTotal)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'El monto del pago no puede superar el total de la cita',
    );
  }
}

/**
 * Reembolso (parcial o total) de un pago COMPLETED. Se acumula en
 * `refund_amount`; mientras quede saldo el pago sigue COMPLETED y cuando se
 * devuelve todo pasa a REFUNDED. Devuelve el nuevo acumulado y el estado.
 */
export function applyRefund(
  payment: {
    status: PaymentStatus;
    amount: number | string;
    refund_amount?: number | string | null;
  },
  refundAmount: number,
): { refundedCents: number; status: PaymentStatus } {
  if (payment.status !== PaymentStatus.COMPLETED) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'Solo se pueden reembolsar pagos completados',
    );
  }
  const cents = toCents(refundAmount);
  if (!(cents > 0)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'El monto del reembolso debe ser mayor que cero',
    );
  }
  const amountCents = toCents(payment.amount);
  const refundedCents = toCents(payment.refund_amount) + cents;
  if (refundedCents > amountCents) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'El monto del reembolso no puede ser mayor al pago original',
    );
  }
  return {
    refundedCents,
    status:
      refundedCents >= amountCents
        ? PaymentStatus.REFUNDED
        : PaymentStatus.COMPLETED,
  };
}
