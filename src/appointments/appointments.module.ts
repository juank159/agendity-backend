import { Module } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from './entities/appointment.entity';
import { ClientsModule } from 'src/clients/clients.module';
import { UsersModule } from 'src/users/users.module';
import { ServicesModule } from 'src/services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Appointment]),
    ClientsModule,
    UsersModule,
    ServicesModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService]
})
export class AppointmentsModule {}
