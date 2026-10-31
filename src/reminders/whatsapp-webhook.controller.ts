import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { ReminderWebhookService } from './reminder-webhook.service';
import { verifyWhatsAppSignature } from './whatsapp-webhook';

/** Cuerpo crudo que guarda `setupApp` para esta ruta (firma de Meta). */
export const WHATSAPP_WEBHOOK_PATH = '/api/webhooks/whatsapp';

/**
 * Webhook de WhatsApp Cloud API (Fase 11.02). Público: lo llama Meta.
 *
 * - `GET`: verificación al registrarlo en Meta. Devuelve `hub.challenge` si
 *   `hub.verify_token` coincide con `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; si no, 403.
 * - `POST`: exige `X-Hub-Signature-256` válida (HMAC-SHA256 del cuerpo crudo
 *   con `WHATSAPP_APP_SECRET`); si no, 401 y no se procesa nada. Sin secreto
 *   configurado, 503. Responde 200 con lo que entendió (Meta no reintenta).
 */
@Public()
@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly webhook: ReminderWebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expected)
      throw new ServiceUnavailableException('Webhook sin configurar');
    if (mode !== 'subscribe' || token !== expected || !challenge) {
      throw new ForbiddenException('Verificación inválida');
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: { rawBody?: Buffer },
    @Body() body: unknown,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret)
      throw new ServiceUnavailableException('Webhook sin configurar');
    if (!verifyWhatsAppSignature(req.rawBody, signature, secret)) {
      this.logger.warn('Webhook de WhatsApp con firma inválida');
      throw new UnauthorizedException('Firma inválida');
    }
    return { received: true, ...(await this.webhook.handle(body)) };
  }
}
