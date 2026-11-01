import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { returnedRows } from 'src/common/utils/query-rows';
import { Client } from 'src/clients/entities/client.entity';
import { consentChange } from 'src/clients/whatsapp-consent';
import { WhatsappConsentLink } from './entities/whatsapp-consent-link.entity';
import {
  CONSENT_LINK_TTL_DAYS,
  consentLinkSecret,
  signConsentToken,
  verifyConsentToken,
} from './consent-token';

/** Ruta de la página pública (fuera de `/api`, como `/reservar`). */
export const CONSENT_PAGE_PATH = '/consentimiento';

/** Qué mensajes recibirá el cliente (lo muestra la página: Ley 1581, finalidad). */
export const CONSENT_PURPOSES = [
  'Recordatorios de tus citas',
  'Aviso cuando toque el mantenimiento de un servicio',
  'Un saludo en tu cumpleaños',
  'Una invitación a volver si llevas tiempo sin visitarnos',
] as const;

export interface ConsentLinkView {
  url: string | null;
  path: string;
  expires_at: Date;
  already_opted_in: boolean;
}

export type ConsentState = 'valid' | 'expired' | 'used';

export interface PublicConsentView {
  state: ConsentState;
  business_name: string;
  client_name: string;
  purposes: readonly string[];
}

const invalid = () =>
  new NotFoundException('Este link de consentimiento no es válido');

/**
 * Consentimiento de WhatsApp por link (11.06). El negocio genera un link por
 * cliente; el cliente lo abre y acepta. Todo ligado a (cliente, negocio): un
 * token de otro negocio, con la firma alterada o de un link inexistente → 404.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly dataSource: DataSource) {}

  async createLink(
    clientId: string,
    tenantId: string,
    createdBy: string,
    now = new Date(),
  ): Promise<ConsentLinkView> {
    const client = await this.dataSource
      .getRepository(Client)
      .findOne({ where: { id: clientId, ownerId: tenantId } });
    if (!client) {
      throw new NotFoundException(`Cliente con ID ${clientId} no encontrado`);
    }
    const expiresAt = new Date(
      // Segundos enteros: el token guarda segundos.
      Math.floor(now.getTime() / 1000) * 1000 +
        CONSENT_LINK_TTL_DAYS * 86_400_000,
    );
    const link = await this.dataSource.getRepository(WhatsappConsentLink).save({
      id: randomUUID(),
      ownerId: tenantId,
      clientId,
      createdBy,
      expiresAt,
    });
    const token = signConsentToken(
      { jti: link.id, clientId, tenantId, expiresAt },
      consentLinkSecret(),
    );
    const path = `${CONSENT_PAGE_PATH}/${token}`;
    const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
    return {
      url: base ? `${base}${path}` : null,
      path,
      expires_at: expiresAt,
      already_opted_in: !!client.whatsapp_opt_in && !client.whatsapp_opt_out_at,
    };
  }

  /** Lo que muestra la página. Token inválido o de otro negocio → 404. */
  async view(token: string, now = new Date()): Promise<PublicConsentView> {
    const row = await this.resolve(token);
    return {
      state: row.accepted_at
        ? 'used'
        : new Date(row.expires_at).getTime() <= now.getTime()
          ? 'expired'
          : 'valid',
      business_name: row.business_name || 'El negocio',
      client_name: row.client_name ?? '',
      purposes: CONSENT_PURPOSES,
    };
  }

  /**
   * Acepta: marca el link como usado (una sola vez, con IP y navegador como
   * prueba) y da el consentimiento con origen `LINK`, en una transacción.
   * Usado → 409; vencido → 409; inválido → 404.
   */
  async accept(
    token: string,
    evidence: { ip: string | null; userAgent: string | null },
    now = new Date(),
  ): Promise<{ state: 'accepted'; business_name: string }> {
    const row = await this.resolve(token);
    await this.dataSource.transaction(async (manager) => {
      const claimed = returnedRows(
        await manager.query(
          `UPDATE whatsapp_consent_links
              SET accepted_at = $2, accepted_ip = $3, accepted_user_agent = $4
            WHERE id = $1 AND accepted_at IS NULL AND expires_at > $2
            RETURNING id`,
          [
            row.id,
            now,
            evidence.ip?.slice(0, 64) ?? null,
            evidence.userAgent?.slice(0, 300) ?? null,
          ],
        ),
      );
      if (!claimed.length) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          row.accepted_at
            ? 'Este link ya se usó'
            : 'Este link venció. Pide uno nuevo al negocio',
        );
      }
      const clients = manager.getRepository(Client);
      const client = await clients.findOneByOrFail({ id: row.client_id });
      const change = consentChange(client, true, 'LINK', now);
      if (Object.keys(change).length) {
        await clients.update({ id: client.id }, change);
      }
    });
    return {
      state: 'accepted',
      business_name: row.business_name || 'El negocio',
    };
  }

  private async resolve(token: string) {
    const payload = verifyConsentToken(token, consentLinkSecret());
    if (!payload) throw invalid();
    const uuid = /^[0-9a-f-]{36}$/i;
    if (
      ![payload.jti, payload.clientId, payload.tenantId].every((v) =>
        uuid.test(v),
      )
    ) {
      throw invalid();
    }
    const [row] = await this.dataSource.query(
      `SELECT l.id, l.client_id, l.expires_at, l.accepted_at,
              c.name AS client_name, b.name AS business_name
         FROM whatsapp_consent_links l
         JOIN clients c ON c.id = l.client_id AND c.owner_id = l.owner_id
         LEFT JOIN business_settings b ON b.tenant_id = l.owner_id
        WHERE l.id = $1 AND l.client_id = $2 AND l.owner_id = $3`,
      [payload.jti, payload.clientId, payload.tenantId],
    );
    if (!row) throw invalid();
    return row as {
      id: string;
      client_id: string;
      expires_at: Date;
      accepted_at: Date | null;
      client_name: string | null;
      business_name: string | null;
    };
  }
}
