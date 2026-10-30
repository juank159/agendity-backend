import { fitsWindows, ScheduleWindow } from 'src/appointments/appointment-slot';

/**
 * Horario de apertura del negocio (8.01). Una franja = un día de la semana
 * (ISO: 1 = lunes … 7 = domingo) y su apertura y cierre (`HH:mm`, hora de
 * pared en la zona del negocio). Un día puede tener varias franjas (p. ej.
 * cerrar a mediodía); un día sin franjas está cerrado.
 *
 * Se guarda como `business_settings.opening_hours` (jsonb): es configuración
 * del negocio que se lee entera con el resto (y en la misma caché), se
 * reemplaza entera por `PATCH /settings` y nunca se consulta por SQL.
 */
export interface OpeningHoursRange {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/** `HH:mm` entre 00:00 y 23:59 (mismo formato que los horarios de los profesionales). */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Franjas del negocio como ventanas del horario (`fitsWindows`). */
export function openingHoursWindows(
  hours: OpeningHoursRange[],
): ScheduleWindow[] {
  return hours.map((range) => ({ ...range, is_available: true }));
}

/** Orden estable: por día y por apertura (así se guardan y se devuelven). */
export function sortOpeningHours(
  hours: OpeningHoursRange[],
): OpeningHoursRange[] {
  return [...hours]
    .map(({ day_of_week, start_time, end_time }) => ({
      day_of_week,
      start_time,
      end_time,
    }))
    .sort(
      (a, b) =>
        a.day_of_week - b.day_of_week ||
        a.start_time.localeCompare(b.start_time),
    );
}

/**
 * ¿La cita [start, end) cae dentro del horario del negocio? `null` = sin
 * configurar: no limita (como antes de 8.01).
 */
export function fitsOpeningHours(
  start: Date,
  end: Date,
  hours: OpeningHoursRange[] | null | undefined,
  timeZone: string,
): boolean {
  if (hours == null) return true;
  return fitsWindows(start, end, openingHoursWindows(hours), timeZone);
}

/** Primer error de coherencia de las franjas (cierre ≤ apertura), o `null`. */
export function openingHoursError(hours: OpeningHoursRange[]): string | null {
  const bad = hours.find((range) => range.end_time <= range.start_time);
  return bad
    ? `La hora de cierre (${bad.end_time}) debe ser posterior a la de apertura (${bad.start_time})`
    : null;
}
