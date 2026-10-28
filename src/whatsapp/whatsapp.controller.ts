// src/whatsapp/whatsapp.controller.ts
import { Controller, Post, Body, Get, Patch, Param } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { CreateWhatsappConfigDto } from './dto/create-whatsapp-config.dto';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';
import { Tenant } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // La configuración es del negocio y trae el apiKey de CallMeBot: solo el Owner
  // la lee, crea o edita (un Employee recibe 403). Mensaje de prueba: cualquier usuario del negocio.
  // No hay ruta para enviar mensajes libres (5.08): CallMeBot solo se usa por dentro
  // (`sendToOwner` del recordatorio automático y `sendTestMessage`).
  @hasRoles(JwtRoles.Owner)
  @Post('config')
  createConfig(
    @Body() createWhatsappConfigDto: CreateWhatsappConfigDto,
    @Tenant() tenantId: string,
  ) {
    return this.whatsappService.create(createWhatsappConfigDto, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('config')
  findConfig(@Tenant() tenantId: string) {
    return this.whatsappService.findByOwnerId(tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch('config/:id')
  updateConfig(
    @Param('id') id: string,
    @Body() updateWhatsappConfigDto: UpdateWhatsappConfigDto,
    @Tenant() tenantId: string,
  ) {
    return this.whatsappService.update(id, updateWhatsappConfigDto, tenantId);
  }

  @Post('test')
  sendTestMessage(@Tenant() tenantId: string) {
    return this.whatsappService.sendTestMessage(tenantId);
  }
}
