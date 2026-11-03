import { fitsWindows, ScheduleWindow } from 'src/appointments/appointment-slot';
import { AppointmentSource } from 'src/common/enums/status.enum';

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

/**
 * Franjas del negocio como ventanas del horario (`fitsWindows`), según el
 * canal que agenda (D-26, 13.07):
 * - `WEB` (link público): las franjas tal cual; un hueco entre franjas (p. ej.
 *   el almuerzo) está cerrado.
 * - `APP` (Owner y Employee): un solo tramo por día, de la primera apertura al
 *   último cierre; el almuerzo del negocio no cierra la app (el horario propio
 *   del profesional y lo ocupado siguen valiendo aparte). Un día sin franjas
 *   sigue cerrado en los dos canales.
 * El canal es obligatorio: quien agenda decide, nunca un valor por defecto.
 */
export function openingHoursWindows(
  hours: OpeningHoursRange[],
  channel: AppointmentSource,
): ScheduleWindow[] {
  const ranges =
    channel === AppointmentSource.WEB ? hours : openingHoursDaySpans(hours);
  return ranges.map(({ day_of_week, start_time, end_time }) => ({
    day_of_week,
    start_time,
    end_time,
    is_available: true,
  }));
}

/**
 * Un tramo por día (D-26): primera apertura → último cierre, ordenado por día.
 * Días sin franjas no aparecen (cerrados).
 */
export function openingHoursDaySpans(
  hours: OpeningHoursRange[],
): OpeningHoursRange[] {
  const byDay = new Map<number, OpeningHoursRange>();
  for (const { day_of_week, start_time, end_time } of hours) {
    const day = Number(day_of_week);
    const span = byDay.get(day);
    byDay.set(day, {
      day_of_week: day,
      start_time:
        span && span.start_time.localeCompare(start_time) <= 0
          ? span.start_time
          : start_time,
      end_time:
        span && span.end_time.localeCompare(end_time) >= 0
          ? span.end_time
          : end_time,
    });
  }
  return [...byDay.values()].sort((a, b) => a.day_of_week - b.day_of_week);
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
 * ¿La cita [start, end) cae dentro del horario del negocio para ese canal
 * (`openingHoursWindows`, D-26)? `null` = sin configurar: no limita (como
 * antes de 8.01).
 */
export function fitsOpeningHours(
  start: Date,
  end: Date,
  hours: OpeningHoursRange[] | null | undefined,
  timeZone: string,
  channel: AppointmentSource,
): boolean {
  if (hours == null) return true;
  return fitsWindows(start, end, openingHoursWindows(hours, channel), timeZone);
}

/** Primer error de coherencia de las franjas (cierre ≤ apertura), o `null`. */
export function openingHoursError(hours: OpeningHoursRange[]): string | null {
  const bad = hours.find((range) => range.end_time <= range.start_time);
  return bad
    ? `La hora de cierre (${bad.end_time}) debe ser posterior a la de apertura (${bad.start_time})`
    : null;
}
