import { Module } from '@nestjs/common';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { SettingsModule } from 'src/settings/settings.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

/** Agenda pública por link (9.01, D-17). */
@Module({
  imports: [AppointmentsModule, SettingsModule, SubscriptionsModule],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}
