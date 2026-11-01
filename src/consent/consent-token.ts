import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Token del link de consentimiento de WhatsApp (11.06). Firmado con HMAC-SHA256
 * (`CONSENT_LINK_SECRET`), de propósito único y ligado a (cliente, negocio):
 *
 *   `v1.<base64url(JSON {j, c, t, e})>.<base64url(firma)>`
 *
 * `j` = id del link (una fila en `whatsapp_consent_links`, que lo hace de un
 * solo uso), `c` = cliente, `t` = negocio, `e` = vence (segundos Unix). La
 * firma cubre `v1.<payload>`: cambiar cualquier dato la invalida.
 */
export const CONSENT_LINK_TTL_DAYS = 30;

export interface ConsentTokenPayload {
  jti: string;
  clientId: string;
  tenantId: string;
  expiresAt: Date;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');

function sign(body: string, secret: string): string {
  return b64(createHmac('sha256', secret).update(body).digest());
}

export function signConsentToken(
  payload: ConsentTokenPayload,
  secret: string,
): string {
  const body = `v1.${b64(
    JSON.stringify({
      j: payload.jti,
      c: payload.clientId,
      t: payload.tenantId,
      e: Math.floor(payload.expiresAt.getTime() / 1000),
    }),
  )}`;
  return `${body}.${sign(body, secret)}`;
}

/** Payload si la firma es válida (aunque esté vencido); `null` si no. */
export function verifyConsentToken(
  token: string,
  secret: string,
): ConsentTokenPayload | null {
  const parts = (token ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || token.length > 600)
    return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(parts[2]);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (
      typeof p.j !== 'string' ||
      typeof p.c !== 'string' ||
      typeof p.t !== 'string' ||
      !Number.isInteger(p.e)
    ) {
      return null;
    }
    return {
      jti: p.j,
      clientId: p.c,
      tenantId: p.t,
      expiresAt: new Date(p.e * 1000),
    };
  } catch {
    return null;
  }
}

/**
 * Secreto de los links: `CONSENT_LINK_SECRET` (obligatorio en producción,
 * `env.validation`). Fuera de producción, sin él, se deriva de
 * `SECRET_KEY_JWT` con una etiqueta propia (nunca el mismo valor).
 */
export function consentLinkSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const own = env.CONSENT_LINK_SECRET?.trim();
  if (own) return own;
  if (env.NODE_ENV === 'production' || !env.SECRET_KEY_JWT) {
    throw new Error('Falta CONSENT_LINK_SECRET');
  }
  return createHmac('sha256', env.SECRET_KEY_JWT)
    .update('agendity:whatsapp-consent-link')
    .digest('hex');
}
