import {
  PipeTransform,
  Injectable,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { isValidDate, parseBusinessDate } from '../utils/date.util';

/**
 * Query de fecha → `Date`. ISO con offset = ese instante; sin offset o solo
 * fecha (`2026-10-21`) = hora del negocio (`parseBusinessDate`).
 *
 * Por defecto la fecha es obligatoria (ausente → 400 "Fecha inválida"). Para
 * un filtro opcional: `new ParseDatePipe({ optional: true })` → `undefined`
 * si no viene (una fecha presente pero inválida sigue siendo 400).
 */
@Injectable()
export class ParseDatePipe implements PipeTransform<string, Date | undefined> {
  // `@Optional()`: usada como clase (`ParseDatePipe`) la instancia Nest y no
  // hay nada que inyectar → opciones por defecto.
  constructor(
    @Optional() private readonly options: { optional?: boolean } = {},
  ) {}

  transform(value: string): Date | undefined {
    if (this.options.optional && (value === undefined || value === '')) {
      return undefined;
    }

    const date = parseBusinessDate(value);

    if (!isValidDate(date)) {
      throw new BadRequestException('Fecha inválida');
    }

    return date;
  }
}
