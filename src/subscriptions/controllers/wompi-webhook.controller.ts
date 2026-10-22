// src/subscriptions/controllers/wompi-webhook.controller.ts

import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Logger,
} from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { WompiService } from '../services/wompi.service';
import { SubscriptionsService } from '../services/subscriptions.service';

// Público: lo llama Wompi sin JWT. La autenticidad se comprueba con la firma del evento.
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

      // Manejar diferentes tipos de eventos para pagos con links
      switch (payload.event) {
        case 'transaction.updated':
          const transaction = payload.data.transaction;

          this.logger.log(
            `Transaction updated: ${transaction.id}, status: ${transaction.status}, reference: ${transaction.reference}`,
          );

          // Procesar si es un pago relacionado con suscripción (verificando la referencia)
          if (
            transaction.reference &&
            transaction.reference.startsWith('sub_')
          ) {
            // Extraer el ID real de la suscripción de la referencia
            const subscriptionId = transaction.reference.substring(4); // Quitar el prefijo "sub_"

            this.logger.log(
              `Found subscription payment for subscription ID: ${subscriptionId}`,
            );

            // Obtener la suscripción correspondiente por su ID real
            let sub;
            try {
              sub =
                await this.subscriptionsService.findSubscriptionById(
                  subscriptionId,
                );
            } catch (error) {
              // Si no se encuentra por ID directo, intentar buscar por tenant_id
              try {
                sub =
                  await this.subscriptionsService.getSubscriptionByTenantId(
                    subscriptionId,
                  );
              } catch (e) {
                this.logger.warn(
                  `Subscription not found for ID or tenant: ${subscriptionId}`,
                );
                break;
              }
            }

            if (sub) {
              this.logger.log(`Found subscription in database: ${sub.id}`);

              if (transaction.status === 'APPROVED') {
                this.logger.log(`Payment approved for subscription ${sub.id}`);

                // Registrar el pago exitoso
                await this.subscriptionsService.recordPayment(
                  sub.tenant_id,
                  sub.id,
                  transaction.amount_in_cents / 100,
                  transaction.currency,
                  'successful',
                  transaction.id,
                  transaction.payment_method?.extra?.receipt_url || '',
                );

                // Actualizar la suscripción a estado activo
                await this.subscriptionsService.handleSubscriptionUpdated(
                  sub.id, // Usar el ID interno de la suscripción
                  'ACTIVE',
                );

                this.logger.log(
                  `Subscription ${sub.id} activated successfully`,
                );
              } else if (
                ['DECLINED', 'ERROR', 'VOIDED'].includes(transaction.status)
              ) {
                this.logger.warn(
                  `Payment failed for subscription ${sub.id}: ${transaction.status}`,
                );

                // Actualizar estado si el pago falló
                await this.subscriptionsService.handleSubscriptionUpdated(
                  sub.id,
                  'FAILED',
                );
              }
            } else {
              this.logger.warn(
                `Subscription not found for ID: ${subscriptionId}`,
              );
            }
          } else {
            this.logger.log(
              `Transaction not related to subscription: ${transaction.reference}`,
            );
          }
          break;

        // Estos eventos son para compatibilidad futura si Wompi implementa suscripciones
        case 'subscription.created':
        case 'subscription.updated':
          if (payload.data && payload.data.subscription) {
            const subscription = payload.data.subscription;
            this.logger.log(
              `Subscription event: ${subscription.id}, status: ${subscription.status}`,
            );
            await this.subscriptionsService.handleSubscriptionUpdated(
              subscription.id,
              subscription.status,
            );
          }
          break;

        case 'subscription.canceled':
          if (payload.data && payload.data.subscription) {
            const canceledSubscription = payload.data.subscription;
            this.logger.log(
              `Subscription canceled: ${canceledSubscription.id}`,
            );
            await this.subscriptionsService.handleSubscriptionUpdated(
              canceledSubscription.id,
              'canceled',
            );
          }
          break;

        default:
          this.logger.log(`Unhandled event type: ${payload.event}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      if (error.stack) {
        this.logger.error(error.stack);
      }
      return { error: 'Webhook processing failed' };
    }
  }
}
