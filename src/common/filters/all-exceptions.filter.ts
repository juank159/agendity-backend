import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { ErrorCode, isErrorCode } from '../constants/error-codes';

/** Cuerpo de todo error HTTP (ARQUITECTURA.md §3). */
export interface ErrorResponseBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: string[];
}

const INTERNAL_MESSAGE =
  'Ha ocurrido un error interno. Por favor, intenta nuevamente.';

/** Mensajes por defecto de Nest/Passport/Express (en inglés) → texto para el usuario. */
const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autorizado. Inicia sesión de nuevo.',
  403: 'No tienes permisos para realizar esta acción',
  404: 'Recurso no encontrado',
  409: 'Conflicto con el estado actual del recurso',
  429: 'Demasiadas solicitudes. Intenta de nuevo en un momento.',
};
const NEST_DEFAULT_TEXTS = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Too Many Requests',
  'ThrottlerException: Too Many Requests',
]);

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.TOO_MANY_REQUESTS;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  }
}

/**
 * Filtro global único (registrado como `APP_FILTER`). Todo error sale como
 * `{ statusCode, code, message: string, details?: string[] }`:
 * - `class-validator` (lista) → 400 `VALIDATION_ERROR`, `message` unido y la lista en `details`;
 * - `BusinessException` → su `code`; `HttpException` → `code` según el HTTP;
 * - errores de TypeORM → 409/400/404 traducidos;
 * - cualquier otro → 500 `INTERNAL_ERROR` sin stack ni mensaje interno (se registra en el log).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (body.statusCode >= 500) {
      const err = exception as Error;
      this.logger.error(err?.message ?? String(exception), err?.stack);
    }

    // Si la respuesta ya salió (p. ej. handlers con @Res()), no se puede reescribir.
    if (response.headersSent) {
      if (body.statusCode < 500) {
        this.logger.warn(`Error tras enviar la respuesta: ${body.message}`);
      }
      return;
    }

    response.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ErrorResponseBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (exception instanceof QueryFailedError) {
      return this.fromQueryFailed(exception);
    }
    if (exception instanceof EntityNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: DEFAULT_MESSAGES[404],
      };
    }
    return this.internal();
  }

  private fromHttpException(exception: HttpException): ErrorResponseBody {
    const statusCode = exception.getStatus();
    if (statusCode >= 500) return this.internal(statusCode);

    const raw = exception.getResponse();
    const payload =
      typeof raw === 'object' && raw !== null
        ? (raw as Record<string, unknown>)
        : { message: raw };
    const rawMessage = payload.message ?? exception.message;

    if (Array.isArray(rawMessage)) {
      const details = rawMessage.map((m) => String(m));
      return {
        statusCode,
        code: ErrorCode.VALIDATION_ERROR,
        message: details.join('\n'),
        details,
      };
    }

    let message = typeof rawMessage === 'string' ? rawMessage : '';
    if (
      !message ||
      NEST_DEFAULT_TEXTS.has(message) ||
      /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(message)
    ) {
      message = DEFAULT_MESSAGES[statusCode] ?? DEFAULT_MESSAGES[400];
    }

    const code = isErrorCode(payload.code)
      ? payload.code
      : codeForStatus(statusCode);

    return { statusCode, code, message };
  }

  private fromQueryFailed(exception: QueryFailedError): ErrorResponseBody {
    const driverError = exception as QueryFailedError & {
      code?: string;
      detail?: string;
    };
    switch (driverError.code) {
      case '23505': {
        // "Key (email)=(x@y.z) already exists." → campo sin revelar el valor.
        const field =
          driverError.detail?.match(/Key \(([^)]+)\)=/)?.[1] ?? 'registro';
        const column = field.split(',')[0].trim().replace(/"/g, '');
        if (column === 'email') {
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.DUPLICATE_EMAIL,
            message: 'Ya existe un registro con ese email',
          };
        }
        if (column === 'phone') {
          return {
            statusCode: HttpStatus.CONFLICT,
            code: ErrorCode.DUPLICATE_PHONE,
            message: 'Ya existe un registro con ese teléfono',
          };
        }
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: `Ya existe un registro con el mismo valor de ${column}`,
        };
      }
      case '23503':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message:
            'No se puede realizar la operación porque hay registros relacionados',
        };
      case '22P02':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ErrorCode.BAD_REQUEST,
          message: 'Formato de dato inválido',
        };
      default:
        // Se registra en `catch` (como todo 500).
        return this.internal();
    }
  }

  private internal(
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
  ): ErrorResponseBody {
    return {
      statusCode,
      code: ErrorCode.INTERNAL_ERROR,
      message: INTERNAL_MESSAGE,
    };
  }
}
