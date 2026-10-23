import { config } from 'dotenv';

/**
 * Fechas y zona horaria del negocio (2.05). ÚNICO sitio que sabe de zonas.
 *
 * Reglas:
 * - En la BD todo es `timestamptz` (un instante). En el código, un `Date` es un
 *   instante: nunca leer sus getters locales (`getHours`, `getDay`, `setHours`…),
 *   porque dependen de la zona del proceso Node. Para "qué hora/día es en el
 *   negocio" usar `zonedParts`, `startOfBusinessDay`, etc.
 * - Entrada: `parseBusinessDate`. Un ISO **con** offset (`Z`, `-05:00`) se
 *   respeta; un ISO **sin** offset (lo que manda hoy la app con
 *   `toLocal().toIso8601String()`) es hora de `BUSINESS_TIMEZONE`, nunca la del
 *   servidor. Una fecha sola (`2026-10-21`) es las 00:00 de ese día en el negocio.
 * - Salida: los `Date` de las respuestas HTTP salen como ISO con el offset del
 *   negocio (`2026-10-21T08:00:00.000-05:00`) por `businessJsonReplacer`
 *   (registrado en `config/app.setup.ts`).
 * - Nunca pasar a TypeORM/pg una cadena sin offset para una columna de fecha:
 *   Postgres la interpretaría con la zona de la sesión. Pasar siempre un `Date`.
 *
 * Usa `Intl` (ICU completo de Node), sin librerías de zonas.
 */

// Los `@Cron(..., { timeZone })` leen la zona al importar sus clases, antes de
// que `ConfigModule.forRoot` cargue el `.env` (mismo patrón que
// `config/data.postgres.source.ts`). `config()` no pisa variables ya definidas.
config();

export const DEFAULT_BUSINESS_TIMEZONE = 'America/Bogota';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Lanza RangeError si la zona no existe.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Zona IANA del negocio: `BUSINESS_TIMEZONE` o `America/Bogota`. Lanza si no es válida. */
export function businessTimeZone(): string {
  const timeZone =
    process.env.BUSINESS_TIMEZONE?.trim() || DEFAULT_BUSINESS_TIMEZONE;
  try {
    formatterFor(timeZone);
  } catch {
    throw new Error(`BUSINESS_TIMEZONE inválida: "${timeZone}"`);
  }
  return timeZone;
}

/** Fecha y hora "de pared" en una zona. `month` 1-12; `weekday` ISO (1 = lunes … 7 = domingo). */
export interface ZonedDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number;
}

export type WallClock = Pick<ZonedDateTime, 'year' | 'month' | 'day'> &
  Partial<Pick<ZonedDateTime, 'hour' | 'minute' | 'second' | 'millisecond'>>;

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

/** Minutos que la zona está por delante de UTC en ese instante (Bogotá: -300). */
export function zoneOffsetMinutes(
  date: Date,
  timeZone: string = businessTimeZone(),
): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  const wallAsUtc = utcMillis({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  });
  const time = date.getTime();
  const wholeSeconds = time - (((time % 1000) + 1000) % 1000);
  return Math.round((wallAsUtc - wholeSeconds) / 60_000);
}

function utcMillis(p: WallClock): number {
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour ?? 0, p.minute ?? 0, p.second ?? 0, p.millisecond ?? 0);
  return d.getTime();
}

/** Fecha y hora del instante en la zona (por defecto, la del negocio). */
export function zonedParts(
  date: Date,
  timeZone: string = businessTimeZone(),
): ZonedDateTime {
  const shifted = new Date(
    date.getTime() + zoneOffsetMinutes(date, timeZone) * 60_000,
  );
  const weekday = shifted.getUTCDay();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    weekday: weekday === 0 ? 7 : weekday,
  };
}

/**
 * Instante de una hora de pared en la zona. Normaliza desbordes (día 32 = día
 * 1 del mes siguiente), como `Date.UTC`.
 */
export function fromZonedParts(
  wall: WallClock,
  timeZone: string = businessTimeZone(),
): Date {
  const wallAsUtc = utcMillis(wall);
  const first = zoneOffsetMinutes(new Date(wallAsUtc), timeZone);
  let time = wallAsUtc - first * 60_000;
  const second = zoneOffsetMinutes(new Date(time), timeZone);
  if (second !== first) time = wallAsUtc - second * 60_000;
  return new Date(time);
}

const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Lee una fecha que llega al API (body o query).
 * - Con offset (`…Z`, `…-05:00`, `…+0100`): ese instante.
 * - Sin offset (`2026-10-21T08:00:00.000`): hora de pared en la zona del negocio.
 * - Solo fecha (`2026-10-21`): 00:00 de ese día en la zona del negocio.
 * - Un `Date` se devuelve tal cual. Cualquier otro formato o una fecha
 *   imposible (31 de febrero, 25:00) → `Invalid Date` (comprobar con `isValidDate`).
 */
export function parseBusinessDate(
  value: string | Date,
  timeZone: string = businessTimeZone(),
): Date {
  if (value instanceof Date) return value;
  const match = ISO_PATTERN.exec(String(value ?? '').trim());
  if (!match) return new Date(NaN);

  const [, y, mo, d, h, mi, s, fraction, offset] = match;
  const wall = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
    second: Number(s ?? 0),
    millisecond: fraction ? Math.floor(Number(`0.${fraction}`) * 1000) : 0,
  };
  if (
    wall.month < 1 ||
    wall.month > 12 ||
    wall.day < 1 ||
    wall.day > daysInMonth(wall.year, wall.month) ||
    wall.hour > 23 ||
    wall.minute > 59 ||
    wall.second > 59
  ) {
    return new Date(NaN);
  }

  if (!offset) return fromZonedParts(wall, timeZone);
  if (offset.toUpperCase() === 'Z') return new Date(utcMillis(wall));

  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const offsetHours = Number(digits.slice(0, 2));
  const offsetMinutes = Number(digits.slice(2) || 0);
  if (offsetHours > 23 || offsetMinutes > 59) return new Date(NaN);
  return new Date(
    utcMillis(wall) - sign * (offsetHours * 60 + offsetMinutes) * 60_000,
  );
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** ISO 8601 con el offset de la zona: `2026-10-21T08:00:00.000-05:00`. */
export function toBusinessIso(
  date: Date,
  timeZone: string = businessTimeZone(),
): string {
  const offset = zoneOffsetMinutes(date, timeZone);
  const p = zonedParts(date, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return (
    `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}` +
    `T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond, 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Día del negocio como `YYYY-MM-DD`. */
export function businessDateKey(
  date: Date,
  timeZone: string = businessTimeZone(),
): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** 00:00:00.000 del día del negocio en que cae el instante. */
export function startOfBusinessDay(
  date: Date,
  timeZone: string = businessTimeZone(),
): Date {
  const { year, month, day } = zonedParts(date, timeZone);
  return fromZonedParts({ year, month, day }, timeZone);
}

/** Último milisegundo (23:59:59.999) del día del negocio en que cae el instante. */
export function endOfBusinessDay(
  date: Date,
  timeZone: string = businessTimeZone(),
): Date {
  const { year, month, day } = zonedParts(date, timeZone);
  return new Date(
    fromZonedParts({ year, month, day: day + 1 }, timeZone).getTime() - 1,
  );
}

/** Minutos desde las 00:00 del negocio (08:30 → 510). */
export function businessMinutesOfDay(
  date: Date,
  timeZone: string = businessTimeZone(),
): number {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute + p.second / 60 + p.millisecond / 60_000;
}

/**
 * Suma meses en el calendario del negocio sin desbordar: 31 de enero + 1 mes =
 * 28/29 de febrero (no 3 de marzo, como hace `Date#setMonth`). Conserva la hora.
 */
export function addBusinessMonths(
  date: Date,
  months: number,
  timeZone: string = businessTimeZone(),
): Date {
  const p = zonedParts(date, timeZone);
  const index = p.month - 1 + months;
  const year = p.year + Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return fromZonedParts(
    { ...p, year, month, day: Math.min(p.day, daysInMonth(year, month)) },
    timeZone,
  );
}

const WEEKDAYS_ES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
];
const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `martes 21 de octubre`, en la zona del negocio (textos de recordatorios). */
export function formatBusinessLongDate(
  date: Date,
  timeZone: string = businessTimeZone(),
): string {
  const p = zonedParts(date, timeZone);
  return `${WEEKDAYS_ES[p.weekday - 1]} ${p.day} de ${MONTHS_ES[p.month - 1]}`;
}

/** `8:00 AM` / `3:30 PM`, en la zona del negocio (textos de recordatorios). */
export function formatBusinessTime(
  date: Date,
  timeZone: string = businessTimeZone(),
): string {
  const { hour, minute } = zonedParts(date, timeZone);
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * `replacer` de JSON para las respuestas HTTP: todo `Date` sale como ISO con el
 * offset del negocio (`toBusinessIso`); un `Date` inválido, como `null` (igual
 * que `JSON.stringify`). Se registra en `config/app.setup.ts`.
 */
export function businessJsonReplacer(
  this: Record<string, unknown>,
  key: string,
  value: unknown,
): unknown {
  const raw = this?.[key];
  if (raw instanceof Date) return isValidDate(raw) ? toBusinessIso(raw) : null;
  return value;
}
