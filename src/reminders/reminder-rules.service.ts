import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { TenantSettingsService } from 'src/settings/tenant-settings.service';
import { ReminderRule } from './entities/reminder-rule.entity';
import { ReminderSettings } from './entities/reminder-settings.entity';
import { ReminderDelivery } from './entities/reminder-delivery.entity';
import {
  CreateReminderRuleDto,
  ListDeliveriesQuery,
  PreviewReminderDto,
  UpdateReminderRuleDto,
  UpdateReminderSettingsDto,
} from './dto/reminder.dto';
import { KIND_DEFAULTS, ReminderKind } from './reminder-kinds';
import { renderTemplate, templateError } from './reminder-template';
import { QuotaView, ReminderQuotaService } from './reminder-quota.service';
import {
  formatBusinessLongDate,
  formatBusinessTime,
} from 'src/common/utils/date.util';
import { ChannelName } from './channels/messaging-channel';

export const DEFAULT_WINDOW = { start: '08:00', end: '20:00' } as const;
export const DEFAULT_SEND_TIME = '10:00';

export interface ReminderSettingsView {
  enabled: boolean;
  send_window_start: string;
  send_window_end: string;
  channel: ChannelName;
  quota: QuotaView;
}

/**
 * Reglas y configuración de los recordatorios automáticos de un negocio
 * (Fase 11.01). Todo filtrado por tenant: una regla ajena responde 404.
 */
@Injectable()
export class ReminderRulesService {
  constructor(
    @InjectRepository(ReminderRule)
    private readonly rules: Repository<ReminderRule>,
    @InjectRepository(ReminderSettings)
    private readonly settings: Repository<ReminderSettings>,
    @InjectRepository(ReminderDelivery)
    private readonly deliveries: Repository<ReminderDelivery>,
    private readonly tenantSettings: TenantSettingsService,
    private readonly quota: ReminderQuotaService,
  ) {}

  async getSettings(
    tenantId: string,
    channel: ChannelName,
    now = new Date(),
  ): Promise<ReminderSettingsView> {
    const row = await this.settings.findOne({ where: { tenant_id: tenantId } });
    const timeZone = await this.tenantSettings.getTimezone(tenantId);
    return {
      enabled: row?.enabled ?? false,
      send_window_start: row?.send_window_start ?? DEFAULT_WINDOW.start,
      send_window_end: row?.send_window_end ?? DEFAULT_WINDOW.end,
      channel,
      quota: await this.quota.view(tenantId, now, timeZone),
    };
  }

  async updateSettings(
    tenantId: string,
    dto: UpdateReminderSettingsDto,
    channel: ChannelName,
  ): Promise<ReminderSettingsView> {
    const current = await this.settings.findOne({
      where: { tenant_id: tenantId },
    });
    const next = this.settings.create({
      tenant_id: tenantId,
      enabled: dto.enabled ?? current?.enabled ?? false,
      send_window_start:
        dto.send_window_start ??
        current?.send_window_start ??
        DEFAULT_WINDOW.start,
      send_window_end:
        dto.send_window_end ?? current?.send_window_end ?? DEFAULT_WINDOW.end,
    });
    await this.settings.save(next);
    return this.getSettings(tenantId, channel);
  }

  list(tenantId: string): Promise<ReminderRule[]> {
    return this.rules.find({
      where: { ownerId: tenantId },
      order: { kind: 'ASC', minutes_before: 'DESC', created_at: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<ReminderRule> {
    const rule = await this.rules.findOne({ where: { id, ownerId: tenantId } });
    if (!rule) throw new NotFoundException(`Regla ${id} no encontrada`);
    return rule;
  }

  async create(
    dto: CreateReminderRuleDto,
    tenantId: string,
  ): Promise<ReminderRule> {
    const rule = this.rules.create({
      ownerId: tenantId,
      kind: dto.kind,
      is_active: dto.is_active ?? true,
      template: dto.template || KIND_DEFAULTS[dto.kind].template,
      category: dto.category ?? KIND_DEFAULTS[dto.kind].category,
      meta_template_name: dto.meta_template_name ?? null,
      ...this.kindFields(dto.kind, dto),
    });
    this.assertValid(rule);
    await this.assertNoDuplicate(rule);
    return this.rules.save(rule);
  }

  async update(
    id: string,
    dto: UpdateReminderRuleDto,
    tenantId: string,
  ): Promise<ReminderRule> {
    const rule = await this.findOne(id, tenantId);
    if (dto.kind && dto.kind !== rule.kind) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        'El tipo de una regla no se puede cambiar; crea otra',
      );
    }
    Object.assign(rule, {
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      ...(dto.template !== undefined
        ? { template: dto.template || KIND_DEFAULTS[rule.kind].template }
        : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.meta_template_name !== undefined
        ? { meta_template_name: dto.meta_template_name }
        : {}),
      ...this.kindFields(rule.kind, { ...rule, ...dto }),
    });
    this.assertValid(rule);
    await this.assertNoDuplicate(rule);
    return this.rules.save(rule);
  }

  async remove(id: string, tenantId: string): Promise<{ deleted: true }> {
    const rule = await this.findOne(id, tenantId);
    await this.rules.remove(rule);
    return { deleted: true };
  }

  /** Texto de ejemplo con datos ficticios, en la zona y con el nombre del negocio. */
  async preview(
    dto: PreviewReminderDto,
    tenantId: string,
  ): Promise<{ text: string }> {
    const template = dto.template || KIND_DEFAULTS[dto.kind].template;
    const error = templateError(template);
    if (error) throw new BusinessException(ErrorCode.VALIDATION_ERROR, error);
    const settings = await this.tenantSettings.getSettings(tenantId);
    const sample = new Date(Date.now() + 24 * 3_600_000);
    return {
      text: renderTemplate(template, {
        cliente: 'Ana',
        negocio: settings.name ?? 'tu negocio',
        servicio: 'Manicure',
        fecha: formatBusinessLongDate(sample, settings.timezone),
        hora: formatBusinessTime(sample, settings.timezone),
        profesional: 'Laura',
        link_reserva: settings.booking_url ?? '',
      }),
    };
  }

  async listDeliveries(tenantId: string, query: ListDeliveriesQuery) {
    return this.deliveries.find({
      where: {
        ownerId: tenantId,
        ...(query.status ? { status: query.status as any } : {}),
        ...(query.client_id ? { clientId: query.client_id } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
    });
  }

  /** Campos propios de cada tipo; los demás quedan en `null`. */
  private kindFields(
    kind: ReminderKind,
    source: Partial<
      Pick<ReminderRule, 'minutes_before' | 'days_without_visit' | 'send_time'>
    >,
  ) {
    return {
      minutes_before:
        kind === 'before_appointment' ? (source.minutes_before ?? null) : null,
      days_without_visit:
        kind === 'win_back' ? (source.days_without_visit ?? null) : null,
      send_time:
        kind === 'before_appointment'
          ? null
          : (source.send_time ?? DEFAULT_SEND_TIME),
    };
  }

  private assertValid(rule: ReminderRule): void {
    const fail = (message: string) => {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, message);
    };
    if (rule.kind === 'before_appointment' && rule.minutes_before == null) {
      fail('minutes_before es obligatorio en un recordatorio antes de la cita');
    }
    if (rule.kind === 'win_back' && rule.days_without_visit == null) {
      fail('days_without_visit es obligatorio en "te extrañamos"');
    }
    if (rule.kind !== 'before_appointment' && rule.category === 'utility') {
      // Meta clasifica cumpleaños, mantenimiento y "te extrañamos" como marketing.
      fail(
        'Cumpleaños, mantenimiento y "te extrañamos" son de categoría marketing',
      );
    }
    const error = templateError(rule.template);
    if (error) fail(error);
  }

  private async assertNoDuplicate(rule: ReminderRule): Promise<void> {
    const query = this.rules
      .createQueryBuilder('r')
      .where('r.owner_id = :owner', { owner: rule.ownerId })
      .andWhere('r.kind = :kind', { kind: rule.kind });
    if (rule.kind === 'before_appointment') {
      query.andWhere('r.minutes_before = :m', { m: rule.minutes_before });
    }
    if (rule.id) query.andWhere('r.id <> :id', { id: rule.id });
    if (await query.getExists()) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        rule.kind === 'before_appointment'
          ? `Ya hay un recordatorio ${rule.minutes_before} minutos antes de la cita`
          : 'Ya hay una regla de este tipo; edítala',
      );
    }
  }
}
