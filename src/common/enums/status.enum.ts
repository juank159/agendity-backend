export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

/**
 * Estado de pago de una CITA (columna `appointments.payment_status`, 2.24).
 * Lo calcula `appointmentPaymentStatus` (payments/payment-rules.ts) con lo
 * pagado neto: PENDING (nada) → PARTIAL (anticipo) → COMPLETED (el total);
 * REFUNDED = se devolvió todo lo pagado. FAILED y CANCELLED existen en el enum
 * de Postgres desde el principio pero el código no los asigna.
 */
export enum AppointmentPaymentStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  TRANSFER = 'TRANSFER',
  ONLINE = 'ONLINE',
}

/**
 * Origen de una cita (9.01, D-17): `APP` = la crea el negocio desde la app;
 * `WEB` = reserva del cliente por el link público (entra `PENDING`, sin pago).
 */
export enum AppointmentSource {
  APP = 'APP',
  WEB = 'WEB',
}
