// src/subscriptions/controllers/wompi-webhook.controller.ts

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Logger,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';

import { WompiService } from '../services/wompi.service';
import { SubscriptionsService } from '../services/subscriptions.service';

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
    @Body() payload: any,
    @Headers('x-wompi-signature') signature: string,
  ) {
    try {
      // Verificar la firma de Wompi
      const isValid = await this.wompiService.verifyWebhookEvent(
        payload,
        signature,
      );

      if (!isValid) {
        this.logger.warn('Invalid webhook signature');
        return { error: 'Invalid signature' };
      }

      this.logger.log(`Processing webhook: ${payload.event}`);

      // Manejar diferentes tipos de eventos
      switch (payload.event) {
        case 'subscription.created':
        case 'subscription.updated':
          const subscription = payload.data.subscription;
          await this.subscriptionsService.handleSubscriptionUpdated(
            subscription.id,
            subscription.status,
          );
          break;

        case 'transaction.updated':
          const transaction = payload.data.transaction;

          // Solo procesar si es un pago de suscripción
          if (
            transaction.reference &&
            transaction.reference.startsWith('sub_')
          ) {
            const subscriptionId = transaction.reference;
            const sub =
              await this.subscriptionsService.getSubscriptionByWompiId(
                subscriptionId,
              );

            if (sub && transaction.status === 'APPROVED') {
              await this.subscriptionsService.recordPayment(
                sub.tenant_id,
                sub.id,
                transaction.amount_in_cents / 100, // Convertir de centavos
                transaction.currency,
                'successful',
                transaction.id,
                transaction.payment_method.extra.receipt_url,
              );
            }
          }
          break;

        case 'subscription.canceled':
          const canceledSubscription = payload.data.subscription;
          await this.subscriptionsService.handleSubscriptionUpdated(
            canceledSubscription.id,
            'canceled',
          );
          break;

        default:
          this.logger.log(`Unhandled event type: ${payload.event}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      return { error: 'Webhook processing failed' };
    }
  }
}
