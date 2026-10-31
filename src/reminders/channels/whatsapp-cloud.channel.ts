import axios, { AxiosError } from 'axios';
import {
  ChannelError,
  MessagingChannel,
  OutgoingMessage,
  SendResult,
} from './messaging-channel';

export interface WhatsAppCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
}

/** Errores de Meta que no se arreglan reintentando (número, plantilla, permisos). */
const PERMANENT_META_CODES = new Set([
  100, 131008, 131009, 131026, 131047, 131051, 132000, 132001, 132005, 132007,
  132012, 132015, 132016, 133010, 190, 10, 200,
]);

/**
 * WhatsApp Cloud API (Graph): mensaje de PLANTILLA desde el número central
 * (D-20). Fuera de la ventana de 24 h Meta solo acepta plantillas aprobadas.
 */
export class WhatsAppCloudChannel implements MessagingChannel {
  readonly name = 'whatsapp_cloud' as const;

  constructor(private readonly config: WhatsAppCloudConfig) {}

  async send(message: OutgoingMessage): Promise<SendResult> {
    const base = this.config.baseUrl ?? 'https://graph.facebook.com';
    const url = `${base}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: message.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: message.templateName,
            language: { code: message.language },
            components: message.params.length
              ? [
                  {
                    type: 'body',
                    parameters: message.params.map((text) => ({
                      type: 'text',
                      // Meta rechaza parámetros vacíos o con saltos de línea.
                      text: text?.replace(/\s+/g, ' ').trim() || '-',
                    })),
                  },
                ]
              : [],
          },
        },
        {
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
          timeout: 15_000,
        },
      );
      const id = response.data?.messages?.[0]?.id;
      if (!id) throw new ChannelError('Respuesta de Meta sin id', true);
      return { providerMessageId: id };
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      throw toChannelError(error as AxiosError);
    }
  }
}

export function toChannelError(error: AxiosError): ChannelError {
  const status = error.response?.status;
  const meta = (error.response?.data as any)?.error;
  const code = meta?.code as number | undefined;
  // Sin el token ni datos del cliente: solo códigos.
  const message = `Meta ${status ?? 'sin respuesta'}${code ? ` (código ${code})` : ''}`;
  if (!status) return new ChannelError(message, true, 'NETWORK');
  if (status === 429 || status >= 500 || code === 130429 || code === 131056) {
    return new ChannelError(message, true, String(code ?? status));
  }
  return new ChannelError(
    message,
    !PERMANENT_META_CODES.has(code ?? -1) && status === 408,
    String(code ?? status),
  );
}
