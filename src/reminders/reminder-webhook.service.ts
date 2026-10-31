import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { returnedRows } from 'src/common/utils/query-rows';
import { defaultBusinessTimeZone } from 'src/common/utils/date.util';
import { toE164 } from 'src/whatsapp/whatsapp-phone';
import {
  isOptOutText,
  parseWhatsAppWebhook,
  WebhookInbound,
  WebhookStatus,
} from './whatsapp-webhook';

/**
 * Lo que llega por el webhook de WhatsApp (Fase 11.02), ya con firma válida:
 *
 * - **Estados** (`sent`/`delivered`/`read`/`failed`) por `provider_message_id`.
 *   Solo avanzan: un evento viejo o repetido no cambia nada (idempotente).
 * - **Bajas**: "STOP" o "BAJA". Si responde a un mensaje nuestro, se da de
 *   baja ese cliente; si no, todos los clientes con ese número (el número de
 *   envío es uno solo para todos los negocios).
 */
@Injectable()
export class ReminderWebhookService {
  private readonly logger = new Logger(ReminderWebhookService.name);

  constructor(private readonly dataSource: DataSource) {}

  async handle(body: unknown): Promise<{ statuses: number; optOuts: number }> {
    const { statuses, inbound } = parseWhatsAppWebhook(body);
    let applied = 0;
    for (const status of statuses) applied += await this.applyStatus(status);
    let optOuts = 0;
    for (const message of inbound) {
      if (isOptOutText(message.text)) optOuts += await this.optOut(message);
    }
    return { statuses: applied, optOuts };
  }

  async applyStatus(s: WebhookStatus): Promise<number> {
    const set =
      s.status === 'failed'
        ? `status = 'failed', reason = 'PROVIDER_ERROR', failed_at = $2, last_error = $3`
        : s.status === 'read'
          ? `status = 'read', read_at = $2, delivered_at = COALESCE(delivered_at, $2)`
          : s.status === 'delivered'
            ? `status = 'delivered', delivered_at = $2`
            : `status = 'sent', sent_at = COALESCE(sent_at, $2)`;
    // Solo hacia adelante: sent(1) < delivered(2) < read(3); failed solo desde sent.
    const from =
      s.status === 'failed'
        ? `('queued', 'sent')`
        : s.status === 'read'
          ? `('queued', 'sent', 'delivered')`
          : s.status === 'delivered'
            ? `('queued', 'sent')`
            : `('queued')`;
    const result = await this.dataSource.query(
      `UPDATE reminder_deliveries SET ${set}, updated_at = now()
        WHERE provider_message_id = $1 AND status IN ${from}
        RETURNING id`,
      s.status === 'failed'
        ? [s.providerMessageId, s.at, s.error]
        : [s.providerMessageId, s.at],
    );
    return returnedRows(result).length;
  }

  async optOut(message: WebhookInbound, now = new Date()): Promise<number> {
    let ids: string[] = [];
    if (message.replyTo) {
      const [row] = await this.dataSource.query(
        `SELECT client_id FROM reminder_deliveries
          WHERE provider_message_id = $1 AND client_id IS NOT NULL`,
        [message.replyTo],
      );
      if (row) ids = [row.client_id];
    }
    if (!ids.length) {
      const digits = message.from.replace(/\D/g, '');
      // Candidatos por dígitos (con o sin indicativo) y confirmación con la
      // misma normalización E.164 que usa el envío.
      const candidates: {
        id: string;
        phone: string;
        countryCode: string;
        timezone: string | null;
      }[] = await this.dataSource.query(
        `SELECT c.id, c.phone, c."countryCode", b.timezone
           FROM clients c
           LEFT JOIN business_settings b ON b.tenant_id = c.owner_id
          WHERE right(regexp_replace(c.phone, '\\D', '', 'g'), 7) = right($1, 7)`,
        [digits],
      );
      ids = candidates
        .filter(
          (c) =>
            toE164(
              c.phone,
              c.countryCode,
              c.timezone ?? defaultBusinessTimeZone(),
            ) === message.from,
        )
        .map((c) => c.id);
    }
    if (!ids.length) {
      this.logger.log('Baja de WhatsApp de un número sin cliente');
      return 0;
    }
    const result = await this.dataSource.query(
      `UPDATE clients SET whatsapp_opt_in = false, whatsapp_opt_out_at = $2
        WHERE id = ANY($1::uuid[]) RETURNING id`,
      [ids, now],
    );
    return returnedRows(result).length;
  }
}
