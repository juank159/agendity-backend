/**
 * Tipos, categorías y estados de los recordatorios automáticos (Fase 11).
 * Única fuente de verdad: entidades, DTOs, motor y tests importan de aquí.
 */
export const REMINDER_KINDS = [
  'before_appointment',
  'maintenance',
  'birthday',
  'win_back',
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** Categorías de plantilla de Meta (cambian el precio y el consentimiento). */
export const REMINDER_CATEGORIES = ['utility', 'marketing'] as const;
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];

export const DELIVERY_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'skipped',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Motivos de `skipped` / `failed` (columna `reason`). */
export const DELIVERY_REASONS = {
  quota: 'QUOTA',
  noConsent: 'NO_CONSENT',
  optedOut: 'OPTED_OUT',
  invalidPhone: 'INVALID_PHONE',
  tooLate: 'TOO_LATE',
  bookedAfter: 'BOOKED_AFTER',
  appointmentChanged: 'APPOINTMENT_CHANGED',
  ruleDisabled: 'RULE_DISABLED',
  remindersDisabled: 'REMINDERS_DISABLED',
  alreadyBooked: 'ALREADY_BOOKED',
  stale: 'STALE',
  maxAttempts: 'MAX_ATTEMPTS',
  provider: 'PROVIDER_ERROR',
} as const;

/** Tipo → categoría por defecto y si la regla es de una cita o de un cliente. */
export const KIND_DEFAULTS: Record<
  ReminderKind,
  { category: ReminderCategory; template: string }
> = {
  before_appointment: {
    category: 'utility',
    template:
      'Hola {cliente}, te recordamos tu cita de {servicio} en {negocio} el {fecha} a las {hora} con {profesional}.',
  },
  maintenance: {
    category: 'marketing',
    template:
      'Hola {cliente}, ya es momento del mantenimiento de {servicio} en {negocio}. Reserva aquí: {link_reserva}',
  },
  birthday: {
    category: 'marketing',
    template:
      '¡Feliz cumpleaños, {cliente}! En {negocio} te deseamos un gran día. Reserva aquí: {link_reserva}',
  },
  win_back: {
    category: 'marketing',
    template:
      'Hola {cliente}, en {negocio} te extrañamos. Reserva tu próxima cita aquí: {link_reserva}',
  },
};

/**
 * ¿Un recordatorio `utility` (de cita) exige opt-in? Sí (D-21, decisión del
 * usuario y política de WhatsApp): TODO envío necesita `whatsapp_opt_in`.
 */
export const UTILITY_REQUIRES_OPT_IN = true;

/** Mensajes al mes en el periodo de prueba (sin plan pagado), D-21. Los planes pagados: 300 (migración `WhatsappQuotaPlans`). */
export const TRIAL_WHATSAPP_QUOTA = 10;
