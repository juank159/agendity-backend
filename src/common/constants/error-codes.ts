import { HttpStatus } from '@nestjs/common';

/**
 * Catálogo de códigos de error (contrato de ARQUITECTURA.md §3).
 * El frontend decide por `code`, nunca comparando el texto de `message`.
 * Para añadir uno: aquí, en la tabla del §3 y en el `ErrorMapper` de Flutter, en la misma tarea.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  PROFESSIONAL_INACTIVE: 'PROFESSIONAL_INACTIVE',
  TRIAL_LIMIT_REACHED: 'TRIAL_LIMIT_REACHED',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  DUPLICATE_PHONE: 'DUPLICATE_PHONE',
  OWNER_NOT_DELETABLE: 'OWNER_NOT_DELETABLE',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  APPOINTMENT_PAID: 'APPOINTMENT_PAID',
  PAYMENT_ALREADY_EXISTS: 'PAYMENT_ALREADY_EXISTS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  CATEGORY_HAS_SERVICES: 'CATEGORY_HAS_SERVICES',
  APPOINTMENT_IN_PAST: 'APPOINTMENT_IN_PAST',
  APPOINTMENT_NOT_STARTED: 'APPOINTMENT_NOT_STARTED',
  OUTSIDE_BUSINESS_HOURS: 'OUTSIDE_BUSINESS_HOURS',
  ONLINE_BOOKING_UNAVAILABLE: 'ONLINE_BOOKING_UNAVAILABLE',
  BOOKING_LIMIT_REACHED: 'BOOKING_LIMIT_REACHED',
  SERVICE_NOT_OFFERED_BY_PROFESSIONAL: 'SERVICE_NOT_OFFERED_BY_PROFESSIONAL',
  SERVICE_INACTIVE: 'SERVICE_INACTIVE',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  INVALID_VERIFICATION_CODE: 'INVALID_VERIFICATION_CODE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP por defecto de cada código según el §3. */
export const ERROR_CODE_STATUS: Record<ErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  SLOT_UNAVAILABLE: HttpStatus.CONFLICT,
  PROFESSIONAL_INACTIVE: HttpStatus.CONFLICT,
  TRIAL_LIMIT_REACHED: HttpStatus.PAYMENT_REQUIRED,
  SUBSCRIPTION_INACTIVE: HttpStatus.PAYMENT_REQUIRED,
  DUPLICATE_EMAIL: HttpStatus.CONFLICT,
  DUPLICATE_PHONE: HttpStatus.CONFLICT,
  OWNER_NOT_DELETABLE: HttpStatus.CONFLICT,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  APPOINTMENT_PAID: HttpStatus.CONFLICT,
  PAYMENT_ALREADY_EXISTS: HttpStatus.CONFLICT,
  EMAIL_NOT_VERIFIED: HttpStatus.CONFLICT,
  CATEGORY_HAS_SERVICES: HttpStatus.CONFLICT,
  APPOINTMENT_IN_PAST: HttpStatus.BAD_REQUEST,
  APPOINTMENT_NOT_STARTED: HttpStatus.CONFLICT,
  OUTSIDE_BUSINESS_HOURS: HttpStatus.CONFLICT,
  ONLINE_BOOKING_UNAVAILABLE: HttpStatus.CONFLICT,
  BOOKING_LIMIT_REACHED: HttpStatus.CONFLICT,
  SERVICE_NOT_OFFERED_BY_PROFESSIONAL: HttpStatus.CONFLICT,
  SERVICE_INACTIVE: HttpStatus.CONFLICT,
  EMAIL_DELIVERY_FAILED: HttpStatus.SERVICE_UNAVAILABLE,
  ACCOUNT_INACTIVE: HttpStatus.FORBIDDEN,
  INVALID_VERIFICATION_CODE: HttpStatus.BAD_REQUEST,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_CODE_STATUS, value)
  );
}

/**
 * Motivo de un `SLOT_UNAVAILABLE` (13.04), en `details.reason`. El `code` y el
 * HTTP no cambian: la app decide por `code` y, si quiere explicar el porqué,
 * por este motivo (nunca por el texto).
 */
export const SlotUnavailableReason = {
  /** La cita no cabe en las franjas `is_available` del profesional ese día. */
  PROFESSIONAL_OFF_SCHEDULE: 'PROFESSIONAL_OFF_SCHEDULE',
  /** Se cruza con un bloqueo de tiempo (`time_block`) del profesional. */
  TIME_BLOCK: 'TIME_BLOCK',
  /** Se cruza con otra cita que ocupa hueco (o un bloqueo, con una cita). */
  APPOINTMENT_OVERLAP: 'APPOINTMENT_OVERLAP',
} as const;
export type SlotUnavailableReason =
  (typeof SlotUnavailableReason)[keyof typeof SlotUnavailableReason];

/** Motivo de un `OUTSIDE_BUSINESS_HOURS` (13.04), en `details.reason`. */
export const OutsideBusinessHoursReason = {
  /** El negocio no abre ese día (ninguna franja de apertura). */
  BUSINESS_CLOSED_DAY: 'BUSINESS_CLOSED_DAY',
  /** Abre ese día, pero la cita no cabe entera en sus franjas. */
  OUTSIDE_OPENING_HOURS: 'OUTSIDE_OPENING_HOURS',
} as const;
export type OutsideBusinessHoursReason =
  (typeof OutsideBusinessHoursReason)[keyof typeof OutsideBusinessHoursReason];
