/**
 * Número en el formato que esperan WhatsApp (`wa.me/<número>`) y CallMeBot:
 * solo dígitos, con el indicativo del país. Regla única (2.09a): la usan
 * `WhatsappService` y los recordatorios manuales.
 *
 * - Con `+` delante: ya trae el indicativo; se quitan los separadores.
 * - Empieza por el indicativo y es más largo que un número local: se respeta.
 * - 10 dígitos (móvil colombiano): se antepone el indicativo (`+57` por defecto,
 *   o el `countryCode` del cliente).
 * - Cualquier otro caso: los dígitos tal cual.
 */
export function toWhatsappPhone(phone: string, countryCode = '+57'): string {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;

  const prefix = (countryCode ?? '').replace(/\D/g, '') || '57';
  if (digits.startsWith(prefix) && digits.length > 10) return digits;
  if (digits.length === 10) return `${prefix}${digits}`;
  return digits;
}

/** Enlace `https://wa.me/<número>?text=<mensaje>` que abre el chat con el texto escrito. */
export function whatsappLink(
  phone: string,
  message: string,
  countryCode?: string,
): string {
  return `https://wa.me/${toWhatsappPhone(phone, countryCode)}?text=${encodeURIComponent(message)}`;
}
