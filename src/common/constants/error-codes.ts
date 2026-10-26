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
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
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
  ACCOUNT_INACTIVE: HttpStatus.FORBIDDEN,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Compatibilidad temporal con la app actual, que decide por el HTTP y por el texto
 * (no por `code`). Estos errores conservan su HTTP de siempre hasta que Flutter
 * migre la feature correspondiente al `ErrorMapper` por `code` (4.05, 4.07, 4.09).
 * Después se quita el `status` explícito y se usa el del §3.
 */
export const LEGACY_STATUS = {
  /** appointments_controller.dart comprueba `statusCode == 400` para el diálogo de suscripción. */
  SLOT_UNAVAILABLE: HttpStatus.BAD_REQUEST,
  /** Mismo camino de error que el resto de fallos al crear/editar una cita en la app. */
  PROFESSIONAL_INACTIVE: HttpStatus.BAD_REQUEST,
  TRIAL_LIMIT_REACHED: HttpStatus.BAD_REQUEST,
  SUBSCRIPTION_INACTIVE: HttpStatus.BAD_REQUEST,
  /** employees_remote_datasource.dart comprueba `statusCode == 403` para OwnerDeletionFailure. */
  OWNER_NOT_DELETABLE_EMPLOYEES: HttpStatus.FORBIDDEN,
} as const;

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_CODE_STATUS, value)
  );
}
