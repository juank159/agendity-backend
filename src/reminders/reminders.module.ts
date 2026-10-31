import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from 'src/settings/settings.module';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import { ReminderRule } from './entities/reminder-rule.entity';
import { ReminderSettings } from './entities/reminder-settings.entity';
import { ReminderDelivery } from './entities/reminder-delivery.entity';
import { WhatsappUsage } from './entities/whatsapp-usage.entity';
import { RemindersController } from './reminders.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { ReminderRulesService } from './reminder-rules.service';
import { ReminderQuotaService } from './reminder-quota.service';
import { ReminderEngineService } from './reminder-engine.service';
import { ReminderWebhookService } from './reminder-webhook.service';
import { MESSAGING_CHANNEL } from './channels/messaging-channel';
import { createMessagingChannel } from './channels/channel.factory';

/** Recordatorios automáticos configurables por negocio (Fase 11, D-20). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReminderRule,
      ReminderSettings,
      ReminderDelivery,
      WhatsappUsage,
      Subscription,
    ]),
    SettingsModule,
  ],
  controllers: [RemindersController, WhatsAppWebhookController],
  providers: [
    ReminderRulesService,
    ReminderQuotaService,
    ReminderEngineService,
    ReminderWebhookService,
    { provide: MESSAGING_CHANNEL, useFactory: () => createMessagingChannel() },
  ],
  exports: [ReminderEngineService, MESSAGING_CHANNEL],
})
export class RemindersModule {}
