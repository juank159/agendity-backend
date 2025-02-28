// src/whatsapp/whatsapp.controller.ts
import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappConfigDto } from './dto/create-whatsapp-config.dto';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('config')
  createConfig(
    @Body() createWhatsappConfigDto: CreateWhatsappConfigDto,
    @GetUser() user: User,
  ) {
    return this.whatsappService.create(createWhatsappConfigDto, user.id);
  }

  @Get('config')
  findConfig(@GetUser() user: User) {
    return this.whatsappService.findByOwnerId(user.id);
  }

  @Patch('config/:id')
  updateConfig(
    @Param('id') id: string,
    @Body() updateWhatsappConfigDto: UpdateWhatsappConfigDto,
    @GetUser() user: User,
  ) {
    return this.whatsappService.update(id, updateWhatsappConfigDto, user.id);
  }

  @Post('send')
  sendMessage(
    @Body() sendMessageDto: SendWhatsappMessageDto,
    @GetUser() user: User,
  ) {
    return this.whatsappService.sendWhatsAppMessage(
      user.id,
      sendMessageDto.phoneNumber,
      sendMessageDto.message,
    );
  }

  @Post('test')
  sendTestMessage(@GetUser() user: User) {
    return this.whatsappService.sendTestMessage(user.id);
  }
}
