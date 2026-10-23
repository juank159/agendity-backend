import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { WompiService } from '../services/wompi.service';
import { SubscriptionsService } from '../services/subscriptions.service';
import { parseWompiEvent, parseWompiTransaction } from '../wompi-event';

/**
 * Eventos de Wompi (2.07). Público: lo llama Wompi sin JWT; la autenticidad
 * se comprueba con el checksum del evento (`WompiService.verifyWebhookEvent`).
 * Respuestas:
 * - 400: cuerpo malformado (sin `event`/`data`, o `transaction.updated` sin
 *   los campos de la transacción). 401: firma inválida. Sin detalle.
 * - 200: evento válido, se haya aplicado, ya estuviera aplicado o se ignore
 *   (estado `PENDING`, referencia ajena, importe distinto). Así Wompi no
 *   reintenta algo que nunca cambiará; lo sospechoso queda en el log y en el
 *   intento.
 * - 5xx: fallo nuestro (p. ej. BD caída). Wompi reintenta y, como la
 *   aplicación es idempotente, el reintento es seguro.
 */
@Public()
@Controller('webhooks/wompi')
export class WompiWebhookController {
  private readonly logger = new Logger(WompiWebhookController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: unknown,
    @Headers('x-event-checksum') headerChecksum?: string,
  ) {
    const event = parseWompiEvent(body);
    if (!event) throw new BadRequestException('Evento inválido');

    if (!this.wompiService.verifyWebhookEvent(event, headerChecksum)) {
      this.logger.warn('Evento de Wompi con firma inválida');
      throw new UnauthorizedException('Firma inválida');
    }

    if (event.event !== 'transaction.updated') {
      this.logger.log(`Evento de Wompi ignorado: ${event.event}`);
      return { received: true };
    }

    const transaction = parseWompiTransaction(event.data.transaction);
    if (!transaction) throw new BadRequestException('Evento inválido');

    await this.subscriptionsService.applyWompiTransaction(transaction);
    return { received: true };
  }
}
