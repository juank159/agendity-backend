import { AppointmentStatus } from 'src/common/enums/status.enum';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { businessMinutesOfDay, zonedParts } from 'src/common/utils/date.util';

/**
 * Reglas puras del hueco de una cita (2.04). ÚNICO sitio donde se calcula la
 * duración y el fin de una cita: en TypeScript (`appointmentEnd`) y en SQL
 * (`appointmentDurationSql`, para las citas ya guardadas). Si cambias la regla,
 * cambia las dos aquí; `appointment-slot.spec.ts` las compara.
 *
 * Zona horaria (2.05): `appointments.date` y `time_block.*` son `timestamptz`
 * (instantes). El horario del profesional (`schedules`: día y horas de pared)
 * se compara en la zona del negocio (la del tenant, 6.02: siempre explícita),
 * nunca con los getters locales del proceso.
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

/** Día ISO de la semana en el negocio (1 = lunes … 7 = domingo), como `schedules.day_of_week`. */
export function isoWeekday(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).weekday;
}

/** `'09:30'` o `'09:30:00'` → minutos desde las 00:00. */
export function timeToMinutes(time: string): number {
  const [h, m = '0', s = '0'] = String(time).split(':');
  return Number(h) * 60 + Number(m) + Number(s) / 60;
}

/**
 * ¿La cita [start, end) cabe en el horario del profesional? Día y horas en la
 * zona del negocio.
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
  timeZone: string,
): boolean {
  if (!schedules?.length) return true;

  const day = isoWeekday(start, timeZone);
  const from = businessMinutesOfDay(start, timeZone);
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

/** Intervalo semiabierto [start, end) de la agenda (cita o bloqueo ya guardados). */
export interface SlotInterval {
  start: Date;
  end: Date;
}

/**
 * ¿Se cruzan [a.start, a.end) y [b.start, b.end)? Misma condición que las
 * consultas de cruces de `AppointmentsService` (`inicio < fin_otro AND fin >
 * inicio_otro`): una cita puede empezar justo cuando termina otra.
 */
export function intervalsOverlap(a: SlotInterval, b: SlotInterval): boolean {
  return (
    a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime()
  );
}

/**
 * Regla del usuario (2.21): solo se agenda a futuro. ÚNICA comprobación de
 * "hora pasada", compartida por crear, mover y `available-slots`. Un inicio
 * es pasado si es anterior a `now` (instantes: la zona del negocio no cambia
 * el resultado). Empezar justo ahora está permitido.
 */
export function startsInPast(start: Date, now: Date = new Date()): boolean {
  return start.getTime() < now.getTime();
}

export const APPOINTMENT_IN_PAST_MESSAGE =
  'No se pueden agendar citas en una fecha u hora que ya pasó';

/** Crear o mover a una hora pasada → `APPOINTMENT_IN_PAST` (400). */
export function assertStartNotInPast(
  start: Date,
  now: Date = new Date(),
): void {
  if (startsInPast(start, now)) {
    throw new BusinessException(
      ErrorCode.APPOINTMENT_IN_PAST,
      APPOINTMENT_IN_PAST_MESSAGE,
    );
  }
}

export const APPOINTMENT_NOT_STARTED_MESSAGE =
  'No se puede completar una cita que aún no ha empezado';

/**
 * Regla 7.03 (decisión del orquestador): una cita solo se completa cuando ya
 * empezó (`now >= inicio`; justo a la hora de inicio sí). Si no →
 * `APPOINTMENT_NOT_STARTED` (409: el estado de la cita aún no lo permite).
 */
export function assertAppointmentStarted(
  start: Date | string,
  now: Date = new Date(),
): void {
  if (new Date(start).getTime() > now.getTime()) {
    throw new BusinessException(
      ErrorCode.APPOINTMENT_NOT_STARTED,
      APPOINTMENT_NOT_STARTED_MESSAGE,
    );
  }
}

/**
 * ¿La cita cambia de fecha? (`next` distinto de `previous`, comparando
 * instantes). Mover reinicia el recordatorio manual (2.18) y exige una hora
 * futura (2.21); reenviar la misma fecha (la app la manda siempre al editar)
 * no cuenta como mover.
 */
export function isRescheduled(
  previous: Date | string,
  next: Date | undefined,
): boolean {
  return !!next && next.getTime() !== new Date(previous).getTime();
}

/** Pasos permitidos (minutos) para listar huecos libres (2.14). */
export const SLOT_STEP_MINUTES = { default: 15, min: 5, max: 240 } as const;

/**
 * Inicios libres de un día del negocio (2.14): la MISMA regla que
 * `AppointmentsService.assertSlotAvailable`, aplicada a cada candidato.
 * - Candidatos: desde las 00:00 del día del negocio (`dayStart`) cada
 *   `stepMinutes`, mientras empiecen antes de `nextDayStart`.
 * - Libre = no ha pasado (`now`, 2.21), cabe en el horario (`fitsSchedule`, sin filas = sin restricción) y
 *   no se cruza con ningún intervalo ocupado (`busy`: bloqueos y citas que no
 *   están `CANCELLED`, ya filtrados por quien los carga).
 * Pura: quien llama carga horarios y ocupación de [dayStart, nextDayStart +
 * duración) con las mismas consultas que la comprobación al guardar.
 */
export function freeSlotStarts(options: {
  dayStart: Date;
  nextDayStart: Date;
  durationMinutes: number;
  stepMinutes: number;
  schedules: ScheduleWindow[];
  busy: SlotInterval[];
  /** Zona del tenant (6.02): día y horario del profesional. */
  timeZone: string;
  /** Inicios anteriores a `now` no se ofrecen (2.21, `startsInPast`). */
  now?: Date;
}): Date[] {
  const { dayStart, nextDayStart, durationMinutes, stepMinutes, timeZone } =
    options;
  if (!(stepMinutes > 0)) return [];
  const starts: Date[] = [];
  for (
    let t = dayStart.getTime();
    t < nextDayStart.getTime();
    t += stepMinutes * 60_000
  ) {
    const slot = {
      start: new Date(t),
      end: new Date(t + durationMinutes * 60_000),
    };
    if (
      !(options.now && startsInPast(slot.start, options.now)) &&
      fitsSchedule(slot.start, slot.end, options.schedules, timeZone) &&
      !options.busy.some((busy) => intervalsOverlap(slot, busy))
    ) {
      starts.push(slot.start);
    }
  }
  return starts;
}
