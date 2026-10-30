/**
 * Reglas puras de la reserva pública (9.01, D-17).
 */

/** Límites de abuso. */
export const PUBLIC_BOOKING_LIMITS = {
  /** Reservas `PENDING` a futuro por teléfono y negocio. */
  maxPendingPerPhone: 3,
  /** Peticiones por IP y minuto: crear reserva. */
  createPerMinute: 5,
  /** Peticiones por IP y minuto: lecturas públicas. */
  readPerMinute: 60,
} as const;

/** Teléfono aceptado: `+` opcional y 7 a 15 dígitos (E.164 sin separadores). */
export const PUBLIC_PHONE = /^\+?\d{7,15}$/;

/** Quita espacios, guiones, puntos y paréntesis: `"(300) 123-4567"` → `"3001234567"`. */
export function normalizePhone(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value;
}

/** Solo dígitos, para comparar con teléfonos guardados con otro formato. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Orden determinista de profesionales para "cualquiera": primero el que tiene
 * menos citas ese día (reparte la carga), luego por nombre y por id.
 */
export function orderForAnyProfessional<
  T extends { id: string; name: string; load: number },
>(candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      a.load - b.load ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** Unión ordenada y sin repetir de los inicios libres de varios profesionales. */
export function unionOfStarts(lists: Date[][]): Date[] {
  const times = new Set<number>();
  for (const list of lists) for (const date of list) times.add(date.getTime());
  return [...times].sort((a, b) => a - b).map((time) => new Date(time));
}
