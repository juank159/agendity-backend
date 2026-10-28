import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import {
  isValidDate,
  parseBusinessDate,
  parseBusinessRangeEnd,
} from '../utils/date.util';
import { TimeZoneRequest, timeZoneFrom } from './tenant-time-zone.decorator';

export interface QueryDateOptions {
  /** Ausente o vacía → `undefined` (por defecto es obligatoria: 400). */
  optional?: boolean;
  /** Fin exclusivo de un rango: solo fecha = ese día entero (2.34). */
  rangeEnd?: boolean;
}

/**
 * Lee y convierte una fecha de la query en la zona del tenant de la sesión
 * (6.02; sustituye a `ParseDatePipe`, que no podía conocer el tenant: un pipe
 * no recibe la petición y hacerlo request-scoped volvería request-scoped a
 * toda la cadena de providers). ISO con offset = ese instante; sin offset o
 * solo fecha = hora del negocio (`parseBusinessDate`). Inválida → 400
 * "Fecha inválida".
 */
export function parseQueryDate(
  value: unknown,
  timeZone: string,
  options: QueryDateOptions = {},
): Date | undefined {
  if (options.optional && (value === undefined || value === '')) {
    return undefined;
  }
  const text = typeof value === 'string' ? value : '';
  const date = options.rangeEnd
    ? parseBusinessRangeEnd(text, timeZone)
    : parseBusinessDate(text, timeZone);
  if (!isValidDate(date)) {
    throw new BadRequestException('Fecha inválida');
  }
  return date;
}

const QueryDateParam = createParamDecorator(
  (
    data: QueryDateOptions & { name: string },
    ctx: ExecutionContext,
  ): Date | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<TimeZoneRequest & { query?: Record<string, unknown> }>();
    return parseQueryDate(
      request.query?.[data.name],
      timeZoneFrom(request),
      data,
    );
  },
);

/** `@QueryDate('startDate', { optional: true }) startDate?: Date`. */
export const QueryDate = (
  name: string,
  options: QueryDateOptions = {},
): ParameterDecorator => QueryDateParam({ name, ...options });
