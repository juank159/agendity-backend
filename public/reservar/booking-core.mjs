/**
 * Lógica pura de la página de reservas (9.02): fechas en la zona del negocio,
 * días del carrusel y rejilla de bloques de hora. Sin DOM, para poder
 * probarla con `node --test` (test/web/booking-core.test.mjs).
 *
 * Regla de oro: nunca se usa la hora local del navegador. Todo pasa por
 * `Intl.DateTimeFormat` con `timeZone` del negocio.
 */

const partsCache = new Map();

function formatter(timeZone) {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Fecha y hora de pared de un instante en la zona: `{ year, month, day, hour, minute }`. */
export function zonedParts(date, timeZone) {
  const out = {};
  for (const { type, value } of formatter(timeZone).formatToParts(date)) {
    if (type !== 'literal') out[type] = Number(value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

/** Día del negocio (`YYYY-MM-DD`) en que cae el instante. */
export function dayKey(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutos que la zona va por delante de UTC en ese instante (Bogotá: -300). */
function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  const seconds = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wallAsUtc - seconds) / 60000);
}

/** Instante de una hora de pared (`YYYY-MM-DD` + minutos desde las 00:00) en la zona. */
export function wallToInstant(ymd, minutesOfDay, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  const first = offsetMinutes(new Date(wall), timeZone);
  let time = wall - first * 60000;
  const second = offsetMinutes(new Date(time), timeZone);
  if (second !== first) time = wall - second * 60000;
  return new Date(time);
}

/** Día ISO de la semana de un `YYYY-MM-DD` (1 = lunes … 7 = domingo). */
export function isoWeekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** `'09:30'` → 570. */
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** `570` → `'09:30'`. */
export function fromMinutes(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Los próximos `count` días del negocio desde hoy (en su zona). */
export function nextDays(now, timeZone, count = 14) {
  const today = dayKey(now, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  const days = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    days.push(
      `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    );
  }
  return days;
}

/** Franjas del negocio ese día (`null` = sin horario configurado). */
export function dayRanges(openingHours, ymd) {
  if (openingHours == null) return null;
  const weekday = isoWeekday(ymd);
  return openingHours
    .filter((r) => Number(r.day_of_week) === weekday)
    .map((r) => [toMinutes(r.start_time), toMinutes(r.end_time)])
    .sort((a, b) => a[0] - b[0]);
}

/** ¿Está cerrado el negocio ese día? (solo si tiene horario y no hay franjas). */
export function isClosedDay(openingHours, ymd) {
  const ranges = dayRanges(openingHours, ymd);
  return ranges !== null && ranges.length === 0;
}

/**
 * Rejilla de bloques de un día, como en la app: inicios cada `step` minutos
 * (alineados a las 00:00, igual que las horas libres del servidor) dentro del
 * horario del negocio, en los que cabe la duración. Disponible = está en
 * `slots` (lo que devuelve la API); el resto, ocupado. Sin horario del
 * negocio, la rejilla va de la primera a la última hora libre. Las horas ya
 * pasadas no se muestran.
 */
export function buildGrid({
  ymd,
  timeZone,
  openingHours,
  step,
  durationMinutes,
  slots,
  now = new Date(),
}) {
  const free = new Set(slots.map((s) => new Date(s).getTime()));
  let ranges = dayRanges(openingHours, ymd);
  if (ranges === null) {
    const minutes = slots.map((s) => {
      const p = zonedParts(new Date(s), timeZone);
      return p.hour * 60 + p.minute;
    });
    if (!minutes.length) return [];
    ranges = [[Math.min(...minutes), Math.max(...minutes) + durationMinutes]];
  }
  const blocks = [];
  const seen = new Set();
  for (const [open, close] of ranges) {
    const first = Math.ceil(open / step) * step;
    for (let m = first; m + durationMinutes <= close; m += step) {
      const start = wallToInstant(ymd, m, timeZone);
      const time = start.getTime();
      if (time < now.getTime() || seen.has(time)) continue;
      seen.add(time);
      blocks.push({
        start,
        label: fromMinutes(m),
        available: free.has(time),
      });
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

/** `$ 30.000` (pesos colombianos, sin decimales). */
export function formatCOP(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

/** `1 h 30 min`, `45 min`. */
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Hora (`9:30 a. m.`) de un instante en la zona del negocio. */
export function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

/** Fecha larga (`lunes, 3 de marzo`) de un instante en la zona del negocio. */
export function formatLongDate(date, timeZone) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(date));
}

/** Etiqueta corta de un día del carrusel: `{ weekday: 'lun', day: '3', month: 'mar' }`. */
export function dayLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const fmt = (options) =>
    new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', ...options })
      .format(date)
      .replace('.', '');
  return {
    weekday: fmt({ weekday: 'short' }),
    day: String(d),
    month: fmt({ month: 'short' }),
  };
}

/** Mensaje humano para un error de la API (`{ status, code, message }`). */
export function errorMessage(error) {
  const status = error?.status;
  switch (error?.code) {
    case 'SLOT_UNAVAILABLE':
    case 'OUTSIDE_BUSINESS_HOURS':
      return 'Esa hora acaba de ocuparse. Te mostramos las horas actualizadas: elige otra.';
    case 'BOOKING_LIMIT_REACHED':
      return (
        error.message || 'Ya tienes varias reservas pendientes en este negocio.'
      );
    case 'ONLINE_BOOKING_UNAVAILABLE':
      return 'Este negocio no está recibiendo reservas en línea en este momento.';
    case 'APPOINTMENT_IN_PAST':
      return 'Esa hora ya pasó. Elige otra.';
    case 'VALIDATION_ERROR':
      return error.message || 'Revisa los datos del formulario.';
    default:
      break;
  }
  if (status === 404) return 'Este link no existe.';
  if (status === 429)
    return 'Hiciste demasiados intentos. Espera un minuto y vuelve a intentarlo.';
  return 'Algo salió mal. Inténtalo de nuevo en unos minutos.';
}
