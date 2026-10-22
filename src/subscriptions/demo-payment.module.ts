import { Module } from '@nestjs/common';
import { DemoPaymentController } from './controllers/demo-payment.controller';

/**
 * Página de pago simulada para desarrollo. `SubscriptionsModule` solo la importa
 * cuando `NODE_ENV=development` (vía `ConditionalModule`).
 */
@Module({
  controllers: [DemoPaymentController],
})
export class DemoPaymentModule {}
