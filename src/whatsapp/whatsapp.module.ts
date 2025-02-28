import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappConfiguration } from './entities/whatsapp-config.entity';
import { WhatsappController } from './whatsapp.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WhatsappConfiguration])],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
