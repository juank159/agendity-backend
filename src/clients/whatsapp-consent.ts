import { Client } from './entities/client.entity';

type Consent = Pick<
  Client,
  'whatsapp_opt_in' | 'whatsapp_opt_in_at' | 'whatsapp_opt_out_at'
>;

/**
 * Cambio de consentimiento de WhatsApp (Fase 11, Ley 1581). Sin cambio, `{}`.
 * Dar el consentimiento lo fecha y borra una baja anterior; quitarlo es la
 * baja (fecha en `whatsapp_opt_out_at`). Lo usan el alta, la edición y la
 * baja por "STOP"/"BAJA".
 */
export function consentChange(
  current: Partial<Consent> | null,
  next: boolean | undefined,
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
        };
  }
  return current && !current.whatsapp_opt_in && current.whatsapp_opt_out_at
    ? {}
    : { whatsapp_opt_in: false, whatsapp_opt_out_at: now };
}
