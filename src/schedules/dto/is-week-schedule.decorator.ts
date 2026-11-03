import { ValidateBy, ValidationOptions } from 'class-validator';
import { weekScheduleError } from '../week-schedule';

/**
 * `schedule` del empleado (13.04): por día, una franja `{ start, end }`
 * (formato anterior) o una lista de franjas; horas `HH:mm`, inicio < fin y
 * franjas del mismo día sin solaparse. El mensaje dice qué falla.
 */
export function IsWeekSchedule(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isWeekSchedule',
      validator: {
        validate: (value: unknown) => weekScheduleError(value) === null,
        defaultMessage: (args) =>
          weekScheduleError(args?.value) ?? 'Horario no válido',
      },
    },
    options,
  );
}
