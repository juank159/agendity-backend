import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODE_STATUS, ErrorCode } from '../constants/error-codes';

/**
 * Datos estructurados de un error de negocio (13.04), en `details` del cuerpo.
 * Siempre un objeto con claves en snake_case; p. ej. `{ reason:
 * 'TIME_BLOCK' }`. (Los errores de validación usan `details` como lista de
 * textos; ver ARQUITECTURA.md §3.)
 */
export type BusinessErrorDetails = Record<string, unknown>;

export interface BusinessExceptionOptions {
  /** HTTP explícito (excepcional); por defecto, el del catálogo. */
  status?: HttpStatus;
  details?: BusinessErrorDetails;
}

/**
 * Error de negocio con `code` estable (ARQUITECTURA.md §3).
 * El filtro global lo serializa como `{ statusCode, code, message, details? }`.
 *
 * @param options HTTP explícito (excepcional; desde 2.34 ningún código usa
 *   HTTP legado) o `{ status?, details? }`. Por defecto, el HTTP del catálogo
 *   y sin `details`.
 */
export class BusinessException extends HttpException {
  readonly details?: BusinessErrorDetails;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: HttpStatus | BusinessExceptionOptions = {},
  ) {
    const { status = ERROR_CODE_STATUS[code], details } =
      typeof options === 'number' ? { status: options } : options;
    super(
      { statusCode: status, code, message, ...(details ? { details } : {}) },
      status,
    );
    this.details = details;
  }
}
