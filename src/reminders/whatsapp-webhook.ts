import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Webhook de WhatsApp Cloud API (Fase 11.02): firma y lectura del cuerpo.
 * Meta firma el cuerpo CRUDO con el App Secret: `X-Hub-Signature-256:
 * sha256=<hex>`. Sin firma válida no se procesa nada.
 */
export function verifyWhatsAppSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface WebhookStatus {
  providerMessageId: string;
  status: ProviderStatus;
  at: Date;
  error: string | null;
}

export interface WebhookInbound {
  /** E.164. */
  from: string;
  text: string;
  /** Mensaje nuestro al que responde (si lo hay). */
  replyTo: string | null;
}

const STATUSES = new Set<ProviderStatus>([
  'sent',
  'delivered',
  'read',
  'failed',
]);

/** Estados y mensajes entrantes del cuerpo; ignora lo que no entiende. */
export function parseWhatsAppWebhook(body: unknown): {
  statuses: WebhookStatus[];
  inbound: WebhookInbound[];
} {
  const statuses: WebhookStatus[] = [];
  const inbound: WebhookInbound[] = [];
  const entries = (body as any)?.entry;
  if (
    (body as any)?.object !== 'whatsapp_business_account' ||
    !Array.isArray(entries)
  ) {
    return { statuses, inbound };
  }
  for (const entry of entries) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value ?? {};
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (typeof s?.id !== 'string' || !STATUSES.has(s.status)) continue;
        const seconds = Number(s.timestamp);
        statuses.push({
          providerMessageId: s.id,
          status: s.status,
          at: Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date(),
          error:
            Array.isArray(s.errors) && s.errors.length
              ? `Meta ${s.errors[0]?.code ?? ''} ${s.errors[0]?.title ?? ''}`.trim()
              : null,
        });
      }
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (typeof m?.from !== 'string') continue;
        const text =
          m.type === 'text'
            ? m.text?.body
            : m.type === 'button'
              ? m.button?.text
              : m.type === 'interactive'
                ? (m.interactive?.button_reply?.title ??
                  m.interactive?.list_reply?.title)
                : null;
        if (typeof text !== 'string') continue;
        inbound.push({
          from: `+${m.from.replace(/\D/g, '')}`,
          text,
          replyTo: typeof m.context?.id === 'string' ? m.context.id : null,
        });
      }
    }
  }
  return { statuses, inbound };
}

/** "STOP", "BAJA" (sin importar mayúsculas, tildes ni signos alrededor). */
export function isOptOutText(text: string): boolean {
  const word = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/gi, '')
    .toUpperCase();
  return word === 'STOP' || word === 'BAJA';
}

/** Orden de los estados de entrega: un evento viejo nunca retrocede uno nuevo. */
export const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};
