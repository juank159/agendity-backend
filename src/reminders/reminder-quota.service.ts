import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Subscription } from 'src/subscriptions/entities/subscription.entity';
import {
  effectiveStatus,
  SubscriptionStatus,
} from 'src/subscriptions/subscription-state';
import { zonedParts } from 'src/common/utils/date.util';
import { TRIAL_WHATSAPP_QUOTA } from './reminder-kinds';

/** `-1` = ilimitado. */
export const UNLIMITED_WHATSAPP = -1;

export interface QuotaView {
  /** Mensajes al mes del plan (o del trial); `-1` = ilimitado. */
  limit: number;
  used: number;
  /** `YYYY-MM` en la zona del negocio. */
  period: string;
}

/** Cupo mensual según la suscripción en `now` (reglas de D-20). */
export function whatsappQuotaOf(
  subscription: Subscription | null,
  now: Date,
): number {
  const status = effectiveStatus(subscription, now);
  if (status === SubscriptionStatus.TRIAL) return TRIAL_WHATSAPP_QUOTA;
  if (status === SubscriptionStatus.ACTIVE) {
    return subscription?.plan?.whatsapp_monthly_quota ?? 0;
  }
  return 0; // vencida, en mora o cancelada: solo envío manual
}

export function usagePeriod(now: Date, timeZone: string): string {
  const { year, month } = zonedParts(now, timeZone);
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Cupo y consumo de mensajes de WhatsApp por negocio y mes (Fase 11.02).
 * `consume` es atómico (`INSERT … ON CONFLICT DO UPDATE … WHERE used <
 * limit`): dos envíos a la vez nunca pasan del cupo.
 */
@Injectable()
export class ReminderQuotaService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Subscription)
    private readonly subscriptions: Repository<Subscription>,
  ) {}

  async limitFor(tenantId: string, now: Date): Promise<number> {
    const subscription = await this.subscriptions.findOne({
      where: { tenant_id: tenantId },
      relations: { plan: true },
      order: { created_at: 'DESC' },
    });
    return whatsappQuotaOf(subscription, now);
  }

  async view(
    tenantId: string,
    now: Date,
    timeZone: string,
  ): Promise<QuotaView> {
    const period = usagePeriod(now, timeZone);
    const [row] = await this.dataSource.query(
      `SELECT used FROM whatsapp_usage WHERE owner_id = $1 AND period = $2`,
      [tenantId, period],
    );
    return {
      limit: await this.limitFor(tenantId, now),
      used: row?.used ?? 0,
      period,
    };
  }

  /** Reserva un mensaje del cupo del mes. `false` = agotado. */
  async consume(
    tenantId: string,
    now: Date,
    timeZone: string,
  ): Promise<boolean> {
    const limit = await this.limitFor(tenantId, now);
    if (limit === 0) return false;
    const rows = await this.dataSource.query(
      `INSERT INTO whatsapp_usage (owner_id, period, used) VALUES ($1, $2, 1)
       ON CONFLICT (owner_id, period) DO UPDATE SET used = whatsapp_usage.used + 1
        WHERE $3::int < 0 OR whatsapp_usage.used < $3::int
       RETURNING used`,
      [tenantId, usagePeriod(now, timeZone), limit],
    );
    return rows.length > 0;
  }

  /** Devuelve al cupo un mensaje que no salió. */
  async release(tenantId: string, now: Date, timeZone: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE whatsapp_usage SET used = GREATEST(used - 1, 0)
        WHERE owner_id = $1 AND period = $2`,
      [tenantId, usagePeriod(now, timeZone)],
    );
  }

  /** ¿Toca avisar al Owner de que se agotó el cupo? Solo la primera vez del mes. */
  async claimExhaustedNotice(
    tenantId: string,
    now: Date,
    timeZone: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `INSERT INTO whatsapp_usage (owner_id, period, used, exhausted_notified_at)
       VALUES ($1, $2, 0, now())
       ON CONFLICT (owner_id, period) DO UPDATE SET exhausted_notified_at = now()
        WHERE whatsapp_usage.exhausted_notified_at IS NULL
       RETURNING period`,
      [tenantId, usagePeriod(now, timeZone)],
    );
    return rows.length > 0;
  }
}
