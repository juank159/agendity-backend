import {
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';

/**
 * Errores de pagos y estadísticas (`PaymentsService`, `PaymentStatsService`):
 * toda HttpException (incluidas BusinessException 409) sale tal cual; el resto
 * se registra en el log y responde 500 con un texto genérico.
 */
export function rethrowPaymentError(
  logger: Logger,
  error: any,
  options: ErrorHandlerOptions,
): never {
  if (error instanceof HttpException) {
    throw error;
  }
  logger.error(
    `Error al ${options.operation} ${options.entity}: ${error?.message}`,
  );
  throw new InternalServerErrorException(
    `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
  );
}
