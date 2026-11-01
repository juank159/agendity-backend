import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappConsentLink } from './entities/whatsapp-consent-link.entity';
import { ConsentService } from './consent.service';
import {
  ConsentLinkController,
  PublicConsentController,
} from './consent.controller';

/** Consentimiento de WhatsApp por link (11.06, Ley 1581). */
@Module({
  imports: [TypeOrmModule.forFeature([WhatsappConsentLink])],
  controllers: [ConsentLinkController, PublicConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
