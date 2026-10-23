import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { isValidDate, parseBusinessDate } from '../utils/date.util';

/**
 * Query de fecha → `Date`. ISO con offset = ese instante; sin offset o solo
 * fecha (`2026-10-21`) = hora del negocio (`parseBusinessDate`).
 */
@Injectable()
export class ParseDatePipe implements PipeTransform<string, Date> {
  transform(value: string): Date {
    const date = parseBusinessDate(value);

    if (!isValidDate(date)) {
      throw new BadRequestException('Fecha inválida');
    }

    return date;
  }
}
