// src/whatsapp/whatsapp.controller.ts
import { Controller, Post, Body, Get, Patch, Param } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappConfigDto } from './dto/create-whatsapp-config.dto';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/interfaces';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('config')
  createConfig(
    @Body() createWhatsappConfigDto: CreateWhatsappConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.whatsappService.create(createWhatsappConfigDto, user.id);
  }

  @Get('config')
  findConfig(@CurrentUser() user: AuthUser) {
    return this.whatsappService.findByOwnerId(user.id);
  }

  @Patch('config/:id')
  updateConfig(
    @Param('id') id: string,
    @Body() updateWhatsappConfigDto: UpdateWhatsappConfigDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.whatsappService.update(id, updateWhatsappConfigDto, user.id);
  }

  @Post('send')
  sendMessage(
    @Body() sendMessageDto: SendWhatsappMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.whatsappService.sendWhatsAppMessage(
      user.id,
      sendMessageDto.phoneNumber,
      sendMessageDto.message,
    );
  }

  @Post('test')
  sendTestMessage(@CurrentUser() user: AuthUser) {
    return this.whatsappService.sendTestMessage(user.id);
  }
}
