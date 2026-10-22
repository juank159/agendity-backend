// src/subscriptions/subscriptions.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentHistory } from './entities/payment-history.entity';

import { WompiService } from './services/wompi.service';
import { SubscriptionsController } from './controllers/subscriptions.controller';
import { WompiWebhookController } from './controllers/wompi-webhook.controller';
import { DemoPaymentModule } from './demo-payment.module';
import { SubscriptionsService } from './services/subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionPlan, Subscription, PaymentHistory]),
    ConfigModule,
    // La página de pago simulada solo existe en desarrollo.
    // `registerWhen` espera a `ConfigModule.forRoot()` (en AppModule) y, por defecto,
    // lanza un error no capturado si tarda más de 5 s. En un arranque en frío con
    // ts-jest (e2e) la carga de módulos puede pasar de 5 s: se amplía el margen.
    ConditionalModule.registerWhen(
      DemoPaymentModule,
      (env: NodeJS.ProcessEnv) => env.NODE_ENV === 'development',
      { timeout: 60000 },
    ),
  ],
  controllers: [SubscriptionsController, WompiWebhookController],
  providers: [SubscriptionsService, WompiService],
  exports: [SubscriptionsService, WompiService],
})
export class SubscriptionsModule {}
