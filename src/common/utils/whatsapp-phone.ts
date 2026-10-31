/**
 * Teléfonos para WhatsApp (movido de `src/whatsapp` al retirar CallMeBot,
 * D-21). `toWhatsappPhone`: número para `wa.me/<número>` (solo dígitos, con
 * indicativo); lo usa el recordatorio manual. `toE164`: el de la Cloud API.
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

/**
 * Plan de numeración mínimo por país (Fase 11): indicativo, longitud del
 * número nacional y con qué empieza un MÓVIL (WhatsApp necesita móvil).
 * Países sin entrada: se acepta cualquier E.164 de 8 a 15 dígitos.
 */
const NUMBERING: Record<string, { national: number; mobile: RegExp }> = {
  '57': { national: 10, mobile: /^3/ }, // Colombia
  '58': { national: 10, mobile: /^4/ }, // Venezuela (0414… sin el 0)
  '52': { national: 10, mobile: /^\d/ }, // México
  '51': { national: 9, mobile: /^9/ }, // Perú
  '593': { national: 9, mobile: /^9/ }, // Ecuador
  '507': { national: 8, mobile: /^6/ }, // Panamá
  '34': { national: 9, mobile: /^[67]/ }, // España
  '1': { national: 10, mobile: /^\d/ }, // EE. UU. / Canadá
};

/** Indicativo del país de una zona IANA (para negocios fuera de Colombia). */
const ZONE_COUNTRY: Record<string, string> = {
  'America/Bogota': '57',
  'America/Caracas': '58',
  'America/Mexico_City': '52',
  'America/Lima': '51',
  'America/Guayaquil': '593',
  'America/Panama': '507',
  'Europe/Madrid': '34',
  'America/New_York': '1',
  'America/Chicago': '1',
  'America/Denver': '1',
  'America/Los_Angeles': '1',
};

export const DEFAULT_CLIENT_COUNTRY_CODE = '+57';

/** Indicativo (solo dígitos) del país de la zona del negocio; `57` si no se conoce. */
export function countryCodeOfZone(timeZone: string | null | undefined): string {
  return ZONE_COUNTRY[timeZone ?? ''] ?? '57';
}

/**
 * Teléfono del cliente en E.164 (`+573001234567`) para la API de WhatsApp, o
 * `null` si no se puede normalizar con seguridad.
 *
 * - Con `+` (o `00`) delante: ya trae el indicativo.
 * - Si no: el `countryCode` del cliente; si es el de por defecto (`+57`, que
 *   la BD pone a todos), manda el país de la zona del negocio.
 * - Se quita un `0` de marcación nacional y, si el número ya empieza por el
 *   indicativo y es más largo que uno nacional, se respeta.
 * - En países conocidos se exige la longitud nacional y prefijo de móvil.
 */
export function toE164(
  phone: string | null | undefined,
  clientCountryCode?: string | null,
  businessTimeZone?: string | null,
): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  let cc: string | null = null;
  if (raw.startsWith('+')) {
    return validInternational(digits);
  }
  if (digits.startsWith('00')) return validInternational(digits.slice(2));

  const explicit = (clientCountryCode ?? '').replace(/\D/g, '');
  cc =
    explicit && `+${explicit}` !== DEFAULT_CLIENT_COUNTRY_CODE
      ? explicit
      : countryCodeOfZone(businessTimeZone);
  const plan = NUMBERING[cc];
  if (
    plan &&
    digits.startsWith(cc) &&
    digits.length === cc.length + plan.national
  ) {
    digits = digits.slice(cc.length);
  }
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (plan) {
    if (digits.length !== plan.national || !plan.mobile.test(digits))
      return null;
    return `+${cc}${digits}`;
  }
  return validInternational(`${cc}${digits}`);
}

function validInternational(digits: string): string | null {
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
    return null;
  }
  for (const [cc, plan] of Object.entries(NUMBERING)) {
    if (digits.startsWith(cc) && digits.length === cc.length + plan.national) {
      return plan.mobile.test(digits.slice(cc.length)) ? `+${digits}` : null;
    }
  }
  return `+${digits}`;
}
