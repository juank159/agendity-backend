import {
  AppointmentPaymentStatus,
  PaymentStatus,
} from 'src/common/enums/status.enum';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';

/**
 * Reglas puras de importes de pagos (2.06). Todo en centavos enteros para no
 * comparar decimales en coma flotante (Postgres devuelve `numeric` como string).
 */

/**
 * Texto de `PAYMENT_ALREADY_EXISTS` (2.23): desde 2.24 (anticipos) solo sale
 * cuando lo pagado neto ya cubre el total. La app decide por `code`.
 */
export const PAYMENT_ALREADY_EXISTS_MESSAGE =
  'La cita ya está pagada por completo';

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
 * Lo pagado de una cita (2.24): suma neta (`amount − refund_amount`) de sus
 * pagos COMPLETED y si alguno tuvo reembolsos. Lo lee
 * `PaymentsService.loadPaidSummary` con la cita bloqueada.
 */
export interface AppointmentPaidSummary {
  paidCents: number;
  hasRefunds: boolean;
}

/**
 * Monto de un pago nuevo (2.24, anticipos): la cita admite varios pagos
 * mientras la suma neta no pase del total. Con la cita ya pagada del todo →
 * `PAYMENT_ALREADY_EXISTS` (409); monto ≤ 0 o mayor que el saldo pendiente →
 * 400. Sin pagos previos el texto es el de siempre ("…superar el total…").
 */
export function assertPaymentAmount(
  amount: number,
  appointmentTotal: number | string,
  paidCents = 0,
): void {
  const totalCents = toCents(appointmentTotal);
  if (paidCents > 0 && paidCents >= totalCents) {
    throw new BusinessException(
      ErrorCode.PAYMENT_ALREADY_EXISTS,
      PAYMENT_ALREADY_EXISTS_MESSAGE,
    );
  }
  const cents = toCents(amount);
  if (!(cents > 0)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'El monto del pago debe ser mayor que cero',
    );
  }
  if (cents > totalCents - paidCents) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      paidCents > 0
        ? `El monto del pago supera el saldo pendiente de la cita ($${fromCents(
            totalCents - paidCents,
          )})`
        : 'El monto del pago no puede superar el total de la cita',
    );
  }
}

/**
 * `payment_status` de la cita según lo pagado neto (2.24): nada → PENDING;
 * menos que el total → PARTIAL; el total → COMPLETED; nada pero hubo
 * reembolsos (se devolvió todo) → REFUNDED.
 */
export function appointmentPaymentStatus(
  appointmentTotal: number | string,
  { paidCents, hasRefunds }: AppointmentPaidSummary,
): AppointmentPaymentStatus {
  if (paidCents > 0) {
    return paidCents >= toCents(appointmentTotal)
      ? AppointmentPaymentStatus.COMPLETED
      : AppointmentPaymentStatus.PARTIAL;
  }
  return hasRefunds
    ? AppointmentPaymentStatus.REFUNDED
    : AppointmentPaymentStatus.PENDING;
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
