import { Client } from './entities/client.entity';

/**
 * Origen del consentimiento de WhatsApp (11.06, prueba para la Ley 1581):
 * `APP` = lo marcó el negocio en la app; `WEB` = casilla de la reserva web;
 * `LINK` = el cliente aceptó en `/consentimiento/<token>` (con IP y
 * navegador en `whatsapp_consent_links`).
 */
export const CONSENT_SOURCES = ['APP', 'WEB', 'LINK'] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

type Consent = Pick<
  Client,
  | 'whatsapp_opt_in'
  | 'whatsapp_opt_in_at'
  | 'whatsapp_opt_out_at'
  | 'whatsapp_opt_in_source'
>;

/**
 * Cambio de consentimiento de WhatsApp (Fase 11, Ley 1581). Sin cambio, `{}`.
 * Dar el consentimiento lo fecha, guarda su origen y borra una baja anterior;
 * quitarlo es la baja (fecha en `whatsapp_opt_out_at`; el origen se conserva
 * como el del último consentimiento). Lo usan el alta y la edición (APP), la
 * reserva web (WEB) y el link de consentimiento (LINK).
 */
export function consentChange(
  current: Partial<Consent> | null,
  next: boolean | undefined,
  source: ConsentSource,
  now: Date = new Date(),
): Partial<Consent> {
  if (next === undefined) return {};
  if (next) {
    return current?.whatsapp_opt_in && !current.whatsapp_opt_out_at
      ? {}
      : {
          whatsapp_opt_in: true,
          whatsapp_opt_in_at: now,
          whatsapp_opt_out_at: null,
          whatsapp_opt_in_source: source,
        };
  }
  return current && !current.whatsapp_opt_in && current.whatsapp_opt_out_at
    ? {}
    : { whatsapp_opt_in: false, whatsapp_opt_out_at: now };
}
