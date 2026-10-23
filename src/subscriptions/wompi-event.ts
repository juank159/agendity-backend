import { createHash, timingSafeEqual } from 'crypto';
import { toCents } from 'src/payments/payment-rules';
import { PaymentAttemptStatus } from './subscription-state';

/**
 * Eventos de Wompi (tarea 2.07). Reglas puras, sin BD ni Nest:
 * - forma del cuerpo y de la transacción (`parseWompiEvent`, `parseWompiTransaction`);
 * - checksum del evento (`wompiEventChecksum`, `hasValidWompiChecksum`);
 * - qué hacer con un intento de pago de plan ante una transacción
 *   (`decideAttemptOutcome`). La usan el webhook y `refresh-status`.
 */

/** Cuerpo de un evento de Wompi. `signature` es opcional aquí: su ausencia invalida la firma (401), no la forma (400). */
export interface WompiEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp?: unknown;
  sent_at?: unknown;
  environment?: unknown;
  signature?: { properties?: unknown; checksum?: unknown };
}

/** Transacción de Wompi (evento `transaction.updated` o `GET /transactions`). */
export interface WompiTransaction {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  reference: string;
  payment_link_id?: string | null;
  receipt_url?: string;
}

export const WompiTransactionStatus = {
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  VOIDED: 'VOIDED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
} as const;

const FAILED_STATUSES: readonly string[] = [
  WompiTransactionStatus.DECLINED,
  WompiTransactionStatus.VOIDED,
  WompiTransactionStatus.ERROR,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Cuerpo con `event` (string) y `data` (objeto); si no, `null` (400). */
export function parseWompiEvent(body: unknown): WompiEvent | null {
  if (!isRecord(body)) return null;
  if (typeof body.event !== 'string' || !body.event) return null;
  if (!isRecord(body.data)) return null;
  return body as unknown as WompiEvent;
}

/** Transacción con los campos que usamos; si falta alguno, `null` (400). */
export function parseWompiTransaction(value: unknown): WompiTransaction | null {
  if (!isRecord(value)) return null;
  const { id, status, amount_in_cents, currency, reference } = value;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (typeof status !== 'string' || !status) return null;
  if (typeof amount_in_cents !== 'number') return null;
  if (!Number.isSafeInteger(amount_in_cents)) return null;
  if (typeof currency !== 'string' || !currency) return null;
  if (typeof reference !== 'string' || !reference) return null;
  const paymentMethod = isRecord(value.payment_method)
    ? value.payment_method
    : null;
  const extra = isRecord(paymentMethod?.extra) ? paymentMethod.extra : null;
  return {
    id: String(id),
    status,
    amount_in_cents,
    currency,
    reference,
    payment_link_id:
      typeof value.payment_link_id === 'string' ? value.payment_link_id : null,
    receipt_url:
      typeof extra?.receipt_url === 'string' ? extra.receipt_url : undefined,
  };
}

/** Valor de una ruta con puntos dentro de `data` ("transaction.amount_in_cents"). */
function valueAt(data: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) => (isRecord(node) ? node[key] : undefined),
      data,
    );
}

/** Solo se firman valores escalares; un objeto o una ausencia invalidan el evento. */
function signableValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

/** `timestamp` del cuerpo: un entero (Wompi envía segundos Unix). */
function timestampValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

/**
 * Checksum según la especificación de Wompi: los valores de
 * `signature.properties` (rutas dentro de `data`, en ESE orden; las decide
 * Wompi), luego `timestamp` y al final el secreto de eventos; SHA256 en hex.
 * `null` si el evento no trae lo necesario para calcularlo.
 */
export function wompiEventChecksum(
  event: WompiEvent,
  secret: string,
): string | null {
  if (!secret) return null;
  const properties = event.signature?.properties;
  if (!Array.isArray(properties) || properties.length === 0) return null;
  const timestamp = timestampValue(event.timestamp);
  if (timestamp === null) return null;

  let concatenated = '';
  for (const property of properties) {
    if (typeof property !== 'string' || !property) return null;
    const value = signableValue(valueAt(event.data, property));
    if (value === null) return null;
    concatenated += value;
  }
  return createHash('sha256')
    .update(concatenated + timestamp + secret)
    .digest('hex');
}

const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** Comparación en tiempo constante de dos hashes SHA256 en hex (sin importar mayúsculas). */
function sameSha256Hex(a: string, b: string): boolean {
  if (!SHA256_HEX.test(a) || !SHA256_HEX.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * ¿El evento lo firmó Wompi con `secret`? Compara `signature.checksum` con el
 * calculado en tiempo constante. La cabecera `X-Event-Checksum`, si llega,
 * debe coincidir también (Wompi envía el mismo valor en los dos sitios).
 */
export function hasValidWompiChecksum(
  event: WompiEvent,
  secret: string,
  headerChecksum?: string,
): boolean {
  const expected = wompiEventChecksum(event, secret);
  if (!expected) return false;
  const bodyChecksum = event.signature?.checksum;
  const received =
    typeof bodyChecksum === 'string' && bodyChecksum
      ? bodyChecksum
      : headerChecksum;
  if (typeof received !== 'string' || !sameSha256Hex(expected, received)) {
    return false;
  }
  if (headerChecksum && !sameSha256Hex(expected, headerChecksum)) return false;
  return true;
}

/** Intento de pago de plan (`payment_history`) tal como lo necesita la decisión. */
export interface PaymentAttemptLike {
  id: string;
  status: string;
  amount: number | string;
  currency: string;
  wompi_transaction_id: string | null;
  created_at?: Date;
}

/**
 * Resultado de aplicar una transacción a los intentos de una referencia:
 * - `activate` / `fail`: escribir en `attempt` (y activar el plan si `activate`);
 * - `duplicate`: esta transacción ya se aplicó (idempotencia);
 * - `amount_mismatch`: importe o moneda distintos al intento → sospechoso, no se activa;
 * - `already_paid`: el intento ya estaba pagado con OTRA transacción (posible doble cobro);
 * - `paid_then_failed`: la transacción ya aplicada como pagada llega ahora rechazada/anulada;
 * - `pending` / `ignored_status`: nada que hacer;
 * - `no_attempt`: la referencia no corresponde a ningún intento de este sistema.
 */
export type AttemptOutcome =
  | { kind: 'activate'; attempt: PaymentAttemptLike }
  | { kind: 'fail'; attempt: PaymentAttemptLike }
  | { kind: 'duplicate'; attempt: PaymentAttemptLike }
  | { kind: 'amount_mismatch'; attempt: PaymentAttemptLike }
  | { kind: 'already_paid'; attempt: PaymentAttemptLike }
  | { kind: 'paid_then_failed'; attempt: PaymentAttemptLike }
  | { kind: 'pending' }
  | { kind: 'ignored_status' }
  | { kind: 'no_attempt' };

/** Importe y moneda del evento iguales a los del intento (en centavos enteros). */
export function matchesAttemptAmount(
  attempt: Pick<PaymentAttemptLike, 'amount' | 'currency'>,
  tx: Pick<WompiTransaction, 'amount_in_cents' | 'currency'>,
): boolean {
  return (
    toCents(attempt.amount) === tx.amount_in_cents &&
    (attempt.currency || 'COP').toUpperCase() === tx.currency.toUpperCase()
  );
}

/**
 * Qué hacer con una transacción de Wompi dados los intentos de su referencia
 * (leídos bajo lock). Reglas:
 * 1. Si un intento ya tiene esta transacción → `duplicate` (o `paid_then_failed`
 *    si estaba pagado y ahora llega rechazada/anulada; o `activate` si estaba
 *    fallido con ella y ahora llega aprobada).
 * 2. `PENDING` → nada. Estado desconocido → nada.
 * 3. Candidatos abiertos (`pending` o `failed`: un enlace rechazado se puede
 *    volver a pagar), el más reciente primero. Si ninguno tiene el importe y la
 *    moneda del evento → `amount_mismatch` (no se activa ni se marca fallido).
 * 4. Sin abiertos: si hay uno pagado y llega otra aprobación → `already_paid`;
 *    si no → `no_attempt`.
 */
export function decideAttemptOutcome(
  attempts: PaymentAttemptLike[],
  tx: WompiTransaction,
): AttemptOutcome {
  const isApproved = tx.status === WompiTransactionStatus.APPROVED;
  const isFailed = FAILED_STATUSES.includes(tx.status);

  const same = attempts.find((a) => a.wompi_transaction_id === tx.id);
  if (same) {
    if (same.status === PaymentAttemptStatus.SUCCESSFUL) {
      return isFailed
        ? { kind: 'paid_then_failed', attempt: same }
        : { kind: 'duplicate', attempt: same };
    }
    if (same.status === PaymentAttemptStatus.FAILED && isApproved) {
      return matchesAttemptAmount(same, tx)
        ? { kind: 'activate', attempt: same }
        : { kind: 'amount_mismatch', attempt: same };
    }
    if (same.status !== PaymentAttemptStatus.PENDING) {
      return { kind: 'duplicate', attempt: same };
    }
  }

  if (tx.status === WompiTransactionStatus.PENDING) return { kind: 'pending' };
  if (!isApproved && !isFailed) return { kind: 'ignored_status' };

  const byRecency = [...attempts].sort(
    (a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0),
  );
  const open = byRecency.filter(
    (a) =>
      a.status === PaymentAttemptStatus.PENDING ||
      a.status === PaymentAttemptStatus.FAILED,
  );
  if (open.length > 0) {
    const target = open.find((a) => matchesAttemptAmount(a, tx));
    if (!target) return { kind: 'amount_mismatch', attempt: open[0] };
    if (isApproved) return { kind: 'activate', attempt: target };
    // Un rechazo no "reabre" nada: solo cierra un intento aún pendiente.
    return target.status === PaymentAttemptStatus.PENDING
      ? { kind: 'fail', attempt: target }
      : { kind: 'duplicate', attempt: target };
  }

  const paid = byRecency.find(
    (a) => a.status === PaymentAttemptStatus.SUCCESSFUL,
  );
  if (paid && isApproved) return { kind: 'already_paid', attempt: paid };
  return paid ? { kind: 'duplicate', attempt: paid } : { kind: 'no_attempt' };
}

/** Id del enlace de pago a partir de su URL (`https://checkout.wompi.co/l/<id>`). */
export function paymentLinkIdFrom(
  url: string | null | undefined,
): string | null {
  const match = /^https:\/\/checkout\.wompi\.co\/l\/([A-Za-z0-9_-]+)$/.exec(
    url ?? '',
  );
  return match ? match[1] : null;
}
