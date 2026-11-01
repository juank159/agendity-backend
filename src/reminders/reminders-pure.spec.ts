import 'reflect-metadata';
import { createHmac } from 'crypto';
import { renderTemplate, templateError } from './reminder-template';
import { insideWindow, nextAllowedTime } from './send-window';
import {
  isOptOutText,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
} from './whatsapp-webhook';
import { toE164, countryCodeOfZone } from '../common/utils/whatsapp-phone';
import { consentChange } from '../clients/whatsapp-consent';
import { whatsappQuotaOf, usagePeriod } from './reminder-quota.service';
import { TRIAL_WHATSAPP_QUOTA } from './reminder-kinds';
import { toChannelError } from './channels/whatsapp-cloud.channel';
import { createMessagingChannel } from './channels/channel.factory';

const BOGOTA = 'America/Bogota';
const CARACAS = 'America/Caracas';
const WINDOW = { start: '08:00', end: '20:00' };

describe('Fase 11: piezas puras de los recordatorios', () => {
  describe('plantillas', () => {
    it('reemplaza las variables y deja vacías las que no tienen valor', () => {
      expect(
        renderTemplate('Hola {cliente}, {negocio} {servicio} {hora}.', {
          cliente: 'Ana',
          negocio: 'Salón Sol',
          hora: null,
        }),
      ).toBe('Hola Ana, Salón Sol .');
    });
    it('una variable desconocida es un error (no se manda en crudo)', () => {
      expect(templateError('Hola {nombre}')).toMatch(/\{nombre\}/);
      expect(templateError('Hola {cliente} {link_reserva}')).toBeNull();
      expect(templateError('  ')).toMatch(/vacía/);
    });
  });

  describe('ventana de envío en la zona del negocio', () => {
    // 2031-03-14T12:30Z = 07:30 en Bogotá (UTC-5) y 08:30 en Caracas (UTC-4).
    const at = new Date('2031-03-14T12:30:00Z');
    it('la misma hora cae fuera en Bogotá y dentro en Caracas', () => {
      expect(insideWindow(at, WINDOW, BOGOTA)).toBe(false);
      expect(insideWindow(at, WINDOW, CARACAS)).toBe(true);
    });
    it('fuera de la ventana se corre al siguiente inicio (mismo día o el siguiente)', () => {
      expect(nextAllowedTime(at, WINDOW, BOGOTA).toISOString()).toBe(
        '2031-03-14T13:00:00.000Z',
      );
      const night = new Date('2031-03-15T02:00:00Z'); // 21:00 en Bogotá
      expect(nextAllowedTime(night, WINDOW, BOGOTA).toISOString()).toBe(
        '2031-03-15T13:00:00.000Z',
      );
      expect(nextAllowedTime(at, WINDOW, CARACAS)).toBe(at);
    });
    it('ventana que cruza medianoche y ventana de todo el día', () => {
      const late = { start: '22:00', end: '06:00' };
      expect(insideWindow(new Date('2031-03-15T04:00:00Z'), late, BOGOTA)).toBe(
        true,
      ); // 23:00
      expect(insideWindow(at, late, BOGOTA)).toBe(false);
      expect(insideWindow(at, { start: '00:00', end: '00:00' }, BOGOTA)).toBe(
        true,
      );
    });
  });

  describe('teléfono E.164', () => {
    it('Colombia: 10 dígitos de móvil, con o sin +57', () => {
      expect(toE164('300 123 4567', '+57', BOGOTA)).toBe('+573001234567');
      expect(toE164('+57 300-123-4567')).toBe('+573001234567');
      expect(toE164('573001234567', '+57', BOGOTA)).toBe('+573001234567');
      expect(toE164('6012345678', '+57', BOGOTA)).toBeNull(); // fijo
      expect(toE164('12345', '+57', BOGOTA)).toBeNull();
      expect(toE164('', '+57', BOGOTA)).toBeNull();
    });
    it('negocio en Caracas: el +57 por defecto no manda; 0414… → +58414…', () => {
      expect(countryCodeOfZone(CARACAS)).toBe('58');
      expect(toE164('04141234567', '+57', CARACAS)).toBe('+584141234567');
      expect(toE164('3001234567', '+57', CARACAS)).toBeNull();
      // Indicativo elegido a mano en el cliente: se respeta.
      expect(toE164('3001234567', '+57', BOGOTA)).toBe('+573001234567');
      expect(toE164('612345678', '+34', BOGOTA)).toBe('+34612345678');
    });
  });

  describe('webhook de WhatsApp', () => {
    const secret = 'secreto-de-prueba';
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const sign = (body: Buffer, key = secret) =>
      `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;
    it('firma válida, firma de otro secreto, cuerpo alterado y sin firma', () => {
      expect(verifyWhatsAppSignature(raw, sign(raw), secret)).toBe(true);
      expect(verifyWhatsAppSignature(raw, sign(raw, 'otro'), secret)).toBe(
        false,
      );
      expect(
        verifyWhatsAppSignature(Buffer.from(`${raw} `), sign(raw), secret),
      ).toBe(false);
      expect(verifyWhatsAppSignature(raw, undefined, secret)).toBe(false);
      expect(verifyWhatsAppSignature(raw, sign(raw), undefined)).toBe(false);
      expect(verifyWhatsAppSignature(raw, 'sha256=zz', secret)).toBe(false);
    });
    it('lee estados y mensajes; ignora lo que no entiende', () => {
      const parsed = parseWhatsAppWebhook({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.1',
                      status: 'delivered',
                      timestamp: '1900000000',
                    },
                    { id: 'wamid.2', status: 'raro' },
                  ],
                  messages: [
                    {
                      from: '573001234567',
                      type: 'text',
                      text: { body: 'Stop' },
                      context: { id: 'wamid.1' },
                    },
                    { from: '573001234567', type: 'image' },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(parsed.statuses).toEqual([
        {
          providerMessageId: 'wamid.1',
          status: 'delivered',
          at: new Date(1900000000 * 1000),
          error: null,
        },
      ]);
      expect(parsed.inbound).toEqual([
        { from: '+573001234567', text: 'Stop', replyTo: 'wamid.1' },
      ]);
      expect(parseWhatsAppWebhook({ object: 'page' })).toEqual({
        statuses: [],
        inbound: [],
      });
    });
    it('baja: STOP y BAJA en cualquier forma; otras palabras no', () => {
      for (const t of ['STOP', 'stop', ' Baja. ', 'BÁJA', 'baja!']) {
        expect(isOptOutText(t)).toBe(true);
      }
      for (const t of ['hola', 'no me des de baja', 'stopp']) {
        expect(isOptOutText(t)).toBe(false);
      }
    });
  });

  describe('consentimiento', () => {
    const now = new Date('2031-01-01T00:00:00Z');
    it('dar, quitar y no cambiar', () => {
      expect(consentChange(null, true, 'APP', now)).toEqual({
        whatsapp_opt_in: true,
        whatsapp_opt_in_at: now,
        whatsapp_opt_out_at: null,
        whatsapp_opt_in_source: 'APP',
      });
      expect(
        consentChange({ whatsapp_opt_in: true }, false, 'APP', now),
      ).toEqual({
        whatsapp_opt_in: false,
        whatsapp_opt_out_at: now,
      });
      expect(
        consentChange({ whatsapp_opt_in: true }, undefined, 'APP', now),
      ).toEqual({});
      expect(
        consentChange(
          { whatsapp_opt_in: true, whatsapp_opt_out_at: null },
          true,
          'APP',
          now,
        ),
      ).toEqual({});
    });
  });

  describe('cupo mensual', () => {
    const now = new Date('2031-01-15T00:00:00Z');
    it('trial, plan activo, ilimitado y vencido', () => {
      expect(whatsappQuotaOf(null, now)).toBe(TRIAL_WHATSAPP_QUOTA);
      const active = {
        status: 'active',
        subscription_end_date: new Date('2031-02-01T00:00:00Z'),
        plan: { whatsapp_monthly_quota: 300 },
      } as any;
      expect(whatsappQuotaOf(active, now)).toBe(300);
      expect(
        whatsappQuotaOf(
          { ...active, plan: { whatsapp_monthly_quota: -1 } },
          now,
        ),
      ).toBe(-1);
      expect(
        whatsappQuotaOf(
          { ...active, subscription_end_date: new Date('2031-01-01') },
          now,
        ),
      ).toBe(0);
    });
    it('el mes es el de la zona del negocio', () => {
      const edge = new Date('2031-02-01T03:00:00Z'); // 22:00 del 31 ene en Bogotá
      expect(usagePeriod(edge, BOGOTA)).toBe('2031-01');
      expect(usagePeriod(edge, 'Europe/Madrid')).toBe('2031-02');
    });
  });

  describe('canal', () => {
    it('errores de Meta: 429/5xx/red se reintentan; número o plantilla inválidos no', () => {
      const err = (status?: number, code?: number) =>
        toChannelError({
          response: status ? { status, data: { error: { code } } } : undefined,
        } as any);
      expect(err(undefined).retryable).toBe(true);
      expect(err(429).retryable).toBe(true);
      expect(err(503).retryable).toBe(true);
      expect(err(400, 131026).retryable).toBe(false);
      expect(err(400, 132001).retryable).toBe(false);
      expect(err(401, 190).message).not.toMatch(/Bearer|token/i);
    });
    it('por defecto y en tests, el canal simulado', () => {
      expect(createMessagingChannel({ NODE_ENV: 'development' }).name).toBe(
        'log',
      );
      expect(
        createMessagingChannel({
          NODE_ENV: 'test',
          MESSAGING_CHANNEL: 'whatsapp_cloud',
        }).name,
      ).toBe('log');
      expect(
        createMessagingChannel({
          NODE_ENV: 'production',
          MESSAGING_CHANNEL: 'whatsapp_cloud',
          WHATSAPP_CLOUD_PHONE_NUMBER_ID: '123456',
          WHATSAPP_CLOUD_ACCESS_TOKEN: 'x',
        }).name,
      ).toBe('whatsapp_cloud');
    });
  });
});
