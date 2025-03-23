import { forwardRef, Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from './entities/appointment.entity';
import { ClientsModule } from 'src/clients/clients.module';
import { UsersModule } from 'src/users/users.module';
import { ServicesModule } from 'src/services/services.module';
import { AppointmentReminderService } from './appointment-reminder.service';
import { WhatsappModule } from 'src/whatsapp/whatsapp.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment]),
    ClientsModule,
    UsersModule,
    forwardRef(() => SubscriptionsModule),
    ServicesModule,
    WhatsappModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentReminderService],
  exports: [AppointmentsService, AppointmentReminderService],
})
export class AppointmentsModule {}
