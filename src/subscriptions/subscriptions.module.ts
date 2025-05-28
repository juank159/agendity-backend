// src/subscriptions/subscriptions.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentHistory } from './entities/payment-history.entity';

import { WompiService } from './services/wompi.service';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { WompiWebhookController } from './controllers/wompi-webhook.controller';
import { DemoPaymentController } from './controllers/demo-payment.controller';
import { SubscriptionsService } from './services/subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionPlan, Subscription, PaymentHistory]),
    ConfigModule,
  ],
  controllers: [
    SubscriptionsController,
    WompiWebhookController,
    DemoPaymentController, // Añadido el nuevo controlador
  ],
  providers: [SubscriptionsService, WompiService],
  exports: [SubscriptionsService, WompiService],
})
export class SubscriptionsModule {}
