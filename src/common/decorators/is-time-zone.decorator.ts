import { ValidateBy, ValidationOptions } from 'class-validator';
import { isValidTimeZone } from '../utils/date.util';

export const INVALID_TIME_ZONE_MESSAGE =
  'La zona horaria no es válida: usa un nombre IANA, por ejemplo America/Bogota';

/**
 * Valida una zona horaria IANA (`America/Bogota`, `Europe/Madrid`) con `Intl`
 * de Node, sin librerías (6.01). Misma regla que `normalizeTimeZone` de
 * `date.util`; un fallo sale como `VALIDATION_ERROR` (400) por el filtro global.
 */
export function IsIanaTimeZone(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isIanaTimeZone',
      validator: {
        validate: (value: unknown) => isValidTimeZone(value),
        defaultMessage: () => INVALID_TIME_ZONE_MESSAGE,
      },
    },
    validationOptions,
  );
}
