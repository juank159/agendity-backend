import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  MessagingChannel,
  OutgoingMessage,
  SendResult,
} from './messaging-channel';

/**
 * Canal simulado (desarrollo y tests): no sale nada a internet. Deja en el
 * log el tipo y la plantilla (sin el teléfono ni el texto: datos personales)
 * y guarda los mensajes en memoria para los tests.
 */
export class LogChannel implements MessagingChannel {
  readonly name = 'log' as const;
  private readonly logger = new Logger('LogChannel');
  readonly sent: (OutgoingMessage & { id: string })[] = [];

  async send(message: OutgoingMessage): Promise<SendResult> {
    const id = `log.${randomUUID()}`;
    this.sent.push({ ...message, id });
    if (this.sent.length > 1000) this.sent.shift();
    this.logger.log(
      `Mensaje simulado ${message.kind} (${message.templateName}) → ${id}`,
    );
    return { providerMessageId: id };
  }
}
