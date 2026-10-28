import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';
import { Client } from './entities/client.entity';
import { UploadModule } from 'src/common/upload/upload.module';
import { SettingsModule } from 'src/settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Client]), UploadModule, SettingsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
