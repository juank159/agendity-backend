import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './entities/payment.entity';
import { CustomPaymentMethod } from './entities/custom-payment-method.entity';
import { CustomPaymentMethodsController } from './custom-payment-methods.controller';
import { CustomPaymentMethodsService } from './custom-payment-methods.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, CustomPaymentMethod]),
    AppointmentsModule,
    NotificationsModule,
  ],
  controllers: [PaymentsController, CustomPaymentMethodsController],
  providers: [PaymentsService, CustomPaymentMethodsService],
  exports: [PaymentsService, CustomPaymentMethodsService],
})
export class PaymentsModule {}
