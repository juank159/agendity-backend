import { fromZonedParts, zonedParts } from '../common/utils/date.util';

/**
 * Ventana de envío de un negocio (Fase 11.01): `[start, end)` en `HH:mm` de su
 * zona. `start == end` = todo el día; `start > end` cruza medianoche (p. ej.
 * 22:00–06:00). Lo que cae fuera se corre al siguiente inicio de ventana.
 */
export interface SendWindow {
  start: string;
  end: string;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function insideWindow(at: Date, window: SendWindow, timeZone: string) {
  const start = minutes(window.start);
  const end = minutes(window.end);
  if (start === end) return true;
  const { hour, minute } = zonedParts(at, timeZone);
  const now = hour * 60 + minute;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** `at` si cae dentro; si no, el siguiente inicio de ventana (en la zona). */
export function nextAllowedTime(
  at: Date,
  window: SendWindow,
  timeZone: string,
): Date {
  if (insideWindow(at, window, timeZone)) return at;
  const p = zonedParts(at, timeZone);
  const [hour, minute] = window.start.split(':').map(Number);
  const today = fromZonedParts(
    { year: p.year, month: p.month, day: p.day, hour, minute },
    timeZone,
  );
  if (today.getTime() > at.getTime()) return today;
  return fromZonedParts(
    { year: p.year, month: p.month, day: p.day + 1, hour, minute },
    timeZone,
  );
}

/** Instante de `HH:mm` del día de pared `ymd` (`YYYY-MM-DD`) en la zona. */
export function atBusinessTime(
  ymd: { year: number; month: number; day: number },
  hhmm: string,
  timeZone: string,
): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  return fromZonedParts({ ...ymd, hour, minute }, timeZone);
}
