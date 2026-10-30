import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** Sincronización para la app sin conexión (10.01, D-18). */
@Module({
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
