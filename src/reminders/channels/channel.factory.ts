import { Logger } from '@nestjs/common';
import { LogChannel } from './log.channel';
import { MessagingChannel } from './messaging-channel';
import { WhatsAppCloudChannel } from './whatsapp-cloud.channel';

/**
 * Canal según `MESSAGING_CHANNEL` (Fase 11): `whatsapp_cloud` o, por defecto,
 * `log` (simulado). `env.validation` ya exige las claves de Meta con
 * `whatsapp_cloud`; en los tests (`NODE_ENV=test`) siempre `log`.
 */
export function createMessagingChannel(
  env: NodeJS.ProcessEnv = process.env,
): MessagingChannel {
  if (env.NODE_ENV !== 'test' && env.MESSAGING_CHANNEL === 'whatsapp_cloud') {
    return new WhatsAppCloudChannel({
      phoneNumberId: env.WHATSAPP_CLOUD_PHONE_NUMBER_ID ?? '',
      accessToken: env.WHATSAPP_CLOUD_ACCESS_TOKEN ?? '',
      apiVersion: env.WHATSAPP_CLOUD_API_VERSION || 'v21.0',
    });
  }
  new Logger('MessagingChannel').log(
    'Recordatorios por WhatsApp en modo simulado (MESSAGING_CHANNEL=log)',
  );
  return new LogChannel();
}
