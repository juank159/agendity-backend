import { EntityManager } from 'typeorm';
import { HHMM } from 'src/settings/opening-hours';

/**
 * Horario semanal de un profesional tal como lo ven la app y la API de
 * empleados (13.04): por día de la semana (`monday` … `sunday`), una lista de
 * franjas `{ start, end }` en `HH:mm` (hora de pared del negocio). Por debajo
 * son filas de `schedules` (una por franja; `day_of_week` ISO 1 = lunes).
 *
 * Única fuente de la conversión filas ↔ días y de las reglas de una franja
 * (formato, inicio < fin, sin solaparse en el mismo día).
 */

/** Día de la app → `schedules.day_of_week` (ISO: lunes = 1). */
export const DAY_NUMBERS: Readonly<Record<string, number>> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

/** Nombre del día para los mensajes de error (`monday` → `lunes`). */
const DAY_LABELS: Readonly<Record<string, string>> = {
  monday: 'lunes',
  tuesday: 'martes',
  wednesday: 'miércoles',
  thursday: 'jueves',
  friday: 'viernes',
  saturday: 'sábado',
  sunday: 'domingo',
};

export const DAY_NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(DAY_NUMBERS).map(([name, number]) => [number, name]),
);

/** Una franja de trabajo: `HH:mm` a `HH:mm`, inicio < fin. */
export interface DaySlot {
  start: string;
  end: string;
}

/**
 * Entrada de `schedule` (alta y edición del empleado). Por día:
 * - lista de franjas (formato 13.04): el día queda EXACTAMENTE con esas
 *   (lista vacía = día libre);
 * - `{ start, end }` (formato anterior, una franja; la app lo envía así hasta
 *   13.05): ver `planScheduleChanges`.
 * Un día que no viene = sin franjas.
 */
export type WeekScheduleInput = Record<string, DaySlot | DaySlot[]>;

/** Fila de `schedules` que hace falta para leer o comparar. */
export interface ScheduleRow {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

/** `'09:00:00'` (columna `time`) o `'09:00'` → `'09:00'`. */
export function toHHmm(time: string): string {
  return String(time ?? '').slice(0, 5);
}

/**
 * Vistas del horario para una respuesta (13.04), solo con las franjas
 * `is_available`, ordenadas por inicio:
 * - `schedule_slots`: `{ monday: [{ start, end }, …] }` (todas las franjas);
 * - `schedule`: formato anterior `{ monday: { start, end } }`, con la PRIMERA
 *   franja del día, para la app hasta 13.05 (que reenvía ese valor al editar
 *   y `planScheduleChanges` lo reconoce sin borrar la franja de la tarde).
 * Un día sin franjas no aparece en ninguna de las dos.
 */
export function scheduleViews(rows: ScheduleRow[] | null | undefined): {
  schedule: Record<string, DaySlot>;
  schedule_slots: Record<string, DaySlot[]>;
} {
  const slots: Record<string, DaySlot[]> = {};
  const available = (rows ?? [])
    .filter((row) => row.is_available && DAY_NAMES[row.day_of_week])
    .map((row) => ({
      day: Number(row.day_of_week),
      start: toHHmm(row.start_time),
      end: toHHmm(row.end_time),
    }))
    .sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (const { day, start, end } of available) {
    (slots[DAY_NAMES[day]] ??= []).push({ start, end });
  }
  const schedule: Record<string, DaySlot> = {};
  for (const [day, list] of Object.entries(slots)) schedule[day] = list[0];
  return { schedule, schedule_slots: slots };
}

function isSlot(value: unknown): value is DaySlot {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as DaySlot).start === 'string' &&
    typeof (value as DaySlot).end === 'string'
  );
}

function overlaps(a: DaySlot, b: DaySlot): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * Primer error de un `schedule` de entrada, en español, o `null` si vale:
 * objeto con días conocidos; cada día, una franja o una lista de franjas;
 * horas `HH:mm`; inicio < fin; franjas del mismo día sin solaparse (se pueden
 * tocar: 09:00-13:00 y 13:00-18:00).
 */
export function weekScheduleError(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'El horario debe ser un objeto por día de la semana';
  }
  for (const [day, raw] of Object.entries(value)) {
    if (!DAY_NUMBERS[day]) {
      return `Día de la semana no válido en el horario: ${day}`;
    }
    const label = DAY_LABELS[day];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const slot of list) {
      if (!isSlot(slot)) {
        return `Cada franja del ${label} debe tener inicio y fin (start, end)`;
      }
      if (!HHMM.test(slot.start) || !HHMM.test(slot.end)) {
        return `Las horas del horario deben tener el formato HH:mm (${label})`;
      }
      if (slot.start >= slot.end) {
        return `El ${label}, la hora de fin (${slot.end}) debe ser posterior a la de inicio (${slot.start})`;
      }
    }
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (overlaps(sorted[i - 1], sorted[i])) {
        return `Las franjas del ${label} se solapan (${sorted[i - 1].start}-${sorted[i - 1].end} y ${sorted[i].start}-${sorted[i].end})`;
      }
    }
  }
  return null;
}

/** Cambios a aplicar en `schedules` de un profesional. */
export interface ScheduleChanges {
  /** Filas `is_available` que sobran (por id). */
  deleteIds: string[];
  /** Franjas nuevas (`is_available = true`). */
  insert: { day_of_week: number; start_time: string; end_time: string }[];
}

/**
 * Qué filas borrar y cuáles crear para dejar el horario como pide `input`
 * (13.04). Solo toca las filas `is_available`: las de no disponibilidad no
 * salen en la API de empleados y se conservan. Una franja que ya existe igual
 * se conserva (mismo id; la sincronización no ve un cambio).
 *
 * Por día:
 * - no viene → sin franjas;
 * - lista → exactamente esas franjas;
 * - `{ start, end }` (formato anterior, una sola franja): si es igual a una
 *   franja que ya tiene ese día, el día no cambia (la app vieja reenvía la
 *   primera franja que vio: así no se pierde la de la tarde); si es otra,
 *   esa franja sustituye a las que se cruzan con ella y se conservan las
 *   demás.
 *
 * `input` ya validado (`weekScheduleError`).
 */
export function planScheduleChanges(
  existing: ScheduleRow[],
  input: WeekScheduleInput,
): ScheduleChanges {
  const changes: ScheduleChanges = { deleteIds: [], insert: [] };
  for (const [name, day] of Object.entries(DAY_NUMBERS)) {
    const current = existing
      .filter((row) => row.is_available && Number(row.day_of_week) === day)
      .map((row) => ({
        id: row.id,
        start: toHHmm(row.start_time),
        end: toHHmm(row.end_time),
      }));
    const desired = desiredSlots(current, input[name]);

    const pending = [...desired];
    for (const row of current) {
      const keep = pending.findIndex(
        (slot) => slot.start === row.start && slot.end === row.end,
      );
      if (keep >= 0) pending.splice(keep, 1);
      else if (row.id) changes.deleteIds.push(row.id);
    }
    for (const slot of pending) {
      changes.insert.push({
        day_of_week: day,
        start_time: slot.start,
        end_time: slot.end,
      });
    }
  }
  return changes;
}

function desiredSlots(
  current: DaySlot[],
  raw: DaySlot | DaySlot[] | undefined,
): DaySlot[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(({ start, end }) => ({ start, end }));
  }
  const slot = { start: raw.start, end: raw.end };
  if (current.some((c) => c.start === slot.start && c.end === slot.end)) {
    return current.map(({ start, end }) => ({ start, end }));
  }
  return [
    slot,
    ...current
      .filter((c) => !overlaps(c, slot))
      .map(({ start, end }) => ({ start, end })),
  ];
}

/**
 * Lock de las escrituras de horario de un profesional hasta el fin de la
 * transacción (2.17): `/schedules` y la edición del empleado (13.04) lo toman,
 * así dos escrituras del mismo profesional no se cruzan.
 */
export async function lockProfessionalSchedule(
  manager: EntityManager,
  professionalId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `schedule:${professionalId}`,
  ]);
}
