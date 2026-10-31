import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { Tenant } from 'src/common/decorators/tenant.decorator';
import {
  CreateReminderRuleDto,
  ListDeliveriesQuery,
  PreviewReminderDto,
  UpdateReminderRuleDto,
  UpdateReminderSettingsDto,
} from './dto/reminder.dto';
import { ReminderRulesService } from './reminder-rules.service';
import {
  MESSAGING_CHANNEL,
  MessagingChannel,
} from './channels/messaging-channel';

/**
 * Recordatorios automáticos del negocio (Fase 11.01). Solo el Owner: son
 * configuración del negocio y el historial trae teléfonos de clientes.
 */
@hasRoles(JwtRoles.Owner)
@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly rules: ReminderRulesService,
    @Inject(MESSAGING_CHANNEL) private readonly channel: MessagingChannel,
  ) {}

  @Get('settings')
  getSettings(@Tenant() tenantId: string) {
    return this.rules.getSettings(tenantId, this.channel.name);
  }

  @Put('settings')
  updateSettings(
    @Tenant() tenantId: string,
    @Body() dto: UpdateReminderSettingsDto,
  ) {
    return this.rules.updateSettings(tenantId, dto, this.channel.name);
  }

  @Get('rules')
  list(@Tenant() tenantId: string) {
    return this.rules.list(tenantId);
  }

  @Post('rules/preview')
  preview(@Tenant() tenantId: string, @Body() dto: PreviewReminderDto) {
    return this.rules.preview(dto, tenantId);
  }

  @Post('rules')
  create(@Tenant() tenantId: string, @Body() dto: CreateReminderRuleDto) {
    return this.rules.create(dto, tenantId);
  }

  @Get('rules/:id')
  findOne(@Tenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.findOne(id, tenantId);
  }

  @Patch('rules/:id')
  update(
    @Tenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReminderRuleDto,
  ) {
    return this.rules.update(id, dto, tenantId);
  }

  @Delete('rules/:id')
  remove(@Tenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.remove(id, tenantId);
  }

  @Get('deliveries')
  deliveries(@Tenant() tenantId: string, @Query() query: ListDeliveriesQuery) {
    return this.rules.listDeliveries(tenantId, query);
  }
}
