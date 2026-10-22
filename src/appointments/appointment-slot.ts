import { AppointmentStatus } from 'src/common/enums/status.enum';

/**
 * Reglas puras del hueco de una cita (2.04). ÚNICO sitio donde se calcula la
 * duración y el fin de una cita: en TypeScript (`appointmentEnd`) y en SQL
 * (`appointmentDurationSql`, para las citas ya guardadas). Si cambias la regla,
 * cambia las dos aquí; `appointment-slot.spec.ts` las compara.
 *
 * Zona horaria: `appointments.date` y `time_block.*` son `timestamp` sin zona
 * ("hora local" del servidor; node-postgres escribe y lee los `Date` en la zona
 * del proceso). Por eso el horario se compara con los getters locales
 * (`getDay`, `getHours`). Lo corrige la 2.05 (`timestamptz`).
 */

/** Minutos que se cuentan por un servicio sin duración (regla vigente). */
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;

/** Estados que NO ocupan el hueco. El resto (PENDING, CONFIRMED, COMPLETED) sí. */
export const NON_BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
];

export function blocksSlot(status: AppointmentStatus | undefined): boolean {
  return !NON_BLOCKING_STATUSES.includes(status);
}

export function serviceDurationMinutes(service: {
  duration?: number | string | null;
}): number {
  const minutes = Number(service?.duration);
  return minutes > 0 ? minutes : DEFAULT_SERVICE_DURATION_MINUTES;
}

export function appointmentDurationMinutes(
  services: { duration?: number | string | null }[] = [],
): number {
  return services.reduce((sum, s) => sum + serviceDurationMinutes(s), 0);
}

export function appointmentEnd(
  start: Date,
  services: { duration?: number | string | null }[] = [],
): Date {
  return new Date(
    start.getTime() + appointmentDurationMinutes(services) * 60_000,
  );
}

/**
 * Misma regla que `serviceDurationMinutes`, en SQL, sumada sobre las filas de
 * `services` unidas a una cita (LEFT JOIN: sin servicios = 0 minutos).
 */
export function appointmentDurationSql(serviceAlias: string): string {
  const d = `${serviceAlias}.duration`;
  return `COALESCE(SUM(CASE WHEN ${serviceAlias}.id IS NULL THEN 0 WHEN ${d} > 0 THEN ${d} ELSE ${DEFAULT_SERVICE_DURATION_MINUTES} END), 0)`;
}

/** Fila de `schedules` (día ISO 1 = lunes … 7 = domingo; horas `HH:mm[:ss]`). */
export interface ScheduleWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

/** Día ISO de la semana (1 = lunes … 7 = domingo), como `schedules.day_of_week`. */
export function isoWeekday(date: Date): number {
  const day = date.getDay(); // 0 = domingo (hora local)
  return day === 0 ? 7 : day;
}

/** `'09:30'` o `'09:30:00'` → minutos desde las 00:00. */
export function timeToMinutes(time: string): number {
  const [h, m = '0', s = '0'] = String(time).split(':');
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/**
 * ¿La cita [start, end) cabe en el horario del profesional?
 * - Sin ninguna fila de horario = horario no configurado → no restringe
 *   (así se comportaba antes de 2.04; el Owner suele no tener horario).
 * - Con horario: debe caer entera en una franja `is_available` de ese día.
 *   Franjas contiguas o solapadas del mismo día se unen (9-13 + 13-18).
 *   Una cita que pasa de medianoche nunca cabe.
 */
export function fitsSchedule(
  start: Date,
  end: Date,
  schedules: ScheduleWindow[],
): boolean {
  if (!schedules?.length) return true;

  const day = isoWeekday(start);
  const from = minutesOfDay(start);
  const to = from + (end.getTime() - start.getTime()) / 60_000;

  const windows = schedules
    .filter((s) => s.is_available && Number(s.day_of_week) === day)
    .map((s) => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)])
    .sort((a, b) => a[0] - b[0]);

  const merged: number[][] = [];
  for (const [s, e] of windows) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  return merged.some(([s, e]) => s <= from && to <= e);
}
