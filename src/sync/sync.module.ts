import { Module } from '@nestjs/common';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { CategoriesModule } from 'src/categories/categories.module';
import { ClientsModule } from 'src/clients/clients.module';
import { PaymentsModule } from 'src/payments/payments.module';
import { ServicesModule } from 'src/services/services.module';
import { TimeBlocksModule } from 'src/time-blocks/time-blocks.module';
import { SyncPushService } from './sync-push.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** Sincronización para la app sin conexión (10.01, D-18). */
@Module({
  imports: [
    AppointmentsModule,
    CategoriesModule,
    ClientsModule,
    PaymentsModule,
    ServicesModule,
    TimeBlocksModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncPushService],
})
export class SyncModule {}
