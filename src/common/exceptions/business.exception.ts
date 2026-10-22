import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODE_STATUS, ErrorCode } from '../constants/error-codes';

/**
 * Error de negocio con `code` estable (ARQUITECTURA.md §3).
 * El filtro global lo serializa como `{ statusCode, code, message }`.
 *
 * @param status HTTP explícito solo para compatibilidad (ver `LEGACY_STATUS`);
 *               por defecto, el del catálogo.
 */
export class BusinessException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus = ERROR_CODE_STATUS[code],
  ) {
    super({ statusCode: status, code, message }, status);
  }
}
