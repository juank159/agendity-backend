import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { returnedRows } from 'src/common/utils/query-rows';
import { remindersCronEnabled } from 'src/appointments/appointment-reminder.service';
import {
  defaultBusinessTimeZone,
  formatBusinessLongDate,
  formatBusinessTime,
  zonedParts,
} from 'src/common/utils/date.util';
import { bookingUrl } from 'src/settings/tenant-settings.service';
import { toE164 } from 'src/whatsapp/whatsapp-phone';
import {
  Notification,
  NotificationType,
  ReceiverType,
} from 'src/notifications/entities/notification.entity';
import {
  ChannelError,
  MESSAGING_CHANNEL,
  META_TEMPLATE_LANGUAGE,
  META_TEMPLATES,
  MessagingChannel,
} from './channels/messaging-channel';
import {
  DELIVERY_REASONS as R,
  ReminderCategory,
  ReminderKind,
  UTILITY_REQUIRES_OPT_IN,
} from './reminder-kinds';
import { ReminderQuotaService } from './reminder-quota.service';
import { renderTemplate, TemplateValues } from './reminder-template';
import { insideWindow, nextAllowedTime, SendWindow } from './send-window';
import { DEFAULT_SEND_TIME, DEFAULT_WINDOW } from './reminder-rules.service';

/** Reintentos: espera tras el intento N (1, 5, 30 y 120 min); al quinto, `failed`. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120] as const;
export const MAX_ATTEMPTS = RETRY_BACKOFF_MINUTES.length + 1;
/** Un envío tomado por un proceso no lo toma otro durante este tiempo. */
export const DISPATCH_LEASE_MINUTES = 5;
export const DISPATCH_BATCH = 50;
/** Mantenimiento y "te extrañamos": tolerancia si el cron no corrió a su hora. */
export const LATE_TOLERANCE_DAYS = 7;

export interface ReminderRunStats {
  planned: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  deferred: number;
}

interface DeliveryContext {
  id: string;
  owner_id: string;
  kind: ReminderKind;
  category: ReminderCategory;
  occurrence_key: string;
  scheduled_for: Date;
  attempts: number;
  client_id: string | null;
  appointment_id: string | null;
  rule_id: string | null;
  rule_active: boolean | null;
  template: string | null;
  meta_template_name: string | null;
  enabled: boolean | null;
  send_window_start: string | null;
  send_window_end: string | null;
  timezone: string | null;
  business_name: string | null;
  slug: string | null;
  client_name: string | null;
  phone: string | null;
  country_code: string | null;
  client_active: boolean | null;
  wa_enabled: boolean | null;
  whatsapp_opt_in: boolean | null;
  whatsapp_opt_out_at: Date | null;
  appt_date: Date | null;
  appt_status: string | null;
  needs_reschedule: boolean | null;
  send_reminder: boolean | null;
  appt_tz: string | null;
  professional_name: string | null;
  service_names: string | null;
  rebooked: boolean;
}

type Outcome =
  | { status: 'skipped'; reason: string }
  | { status: 'deferred'; until: Date }
  | { status: 'send'; phone: string; values: TemplateValues; timeZone: string };

/** Zona de un negocio en SQL (`business_settings`, o la de por defecto). */
const TZ = (alias: string, param: string) =>
  `COALESCE((SELECT timezone FROM business_settings WHERE tenant_id = ${alias}.owner_id), ${param})`;

/**
 * Motor de recordatorios automáticos (Fase 11.02). Cada minuto:
 *
 * 1. **Planifica**: por cada regla activa de un negocio con los recordatorios
 *    encendidos, inserta las entregas que ya tocan (`queued`). La clave única
 *    (regla, objetivo, ocurrencia) hace que correrlo dos veces no duplique.
 * 2. **Envía**: toma las entregas vencidas con `FOR UPDATE SKIP LOCKED` y un
 *    lease, revalida (regla, cita, consentimiento, teléfono), respeta la
 *    ventana del negocio, consume el cupo y manda por el canal configurado.
 *
 * Las horas son de la zona de cada negocio (D-15). El recordatorio interno al
 * profesional (D-05) sigue en `AppointmentReminderService`.
 */
@Injectable()
export class ReminderEngineService {
  private readonly logger = new Logger(ReminderEngineService.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly quota: ReminderQuotaService,
    @Inject(MESSAGING_CHANNEL) private readonly channel: MessagingChannel,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'automatic-reminders' })
  async runScheduled(): Promise<void> {
    if (!remindersCronEnabled() || this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (error) {
      this.logger.error(
        `Error en los recordatorios automáticos: ${error.message}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Una pasada (planificar + enviar). Con `tenantId`, solo ese negocio (tests). */
  async runOnce(now: Date, tenantId?: string): Promise<ReminderRunStats> {
    const stats: ReminderRunStats = {
      planned: await this.plan(now, tenantId),
      sent: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      deferred: 0,
    };
    for (;;) {
      const ids = await this.claim(now, tenantId);
      if (!ids.length) break;
      for (const id of ids) {
        const result = await this.dispatchOne(id, now);
        stats[result]++;
      }
      if (ids.length < DISPATCH_BATCH) break;
    }
    return stats;
  }

  // ---------------------------------------------------------------- planificar

  async plan(now: Date, tenantId?: string): Promise<number> {
    const rules: {
      id: string;
      owner_id: string;
      kind: ReminderKind;
      category: ReminderCategory;
      minutes_before: number | null;
      days_without_visit: number | null;
      send_time: string | null;
    }[] = await this.dataSource.query(
      `SELECT r.id, r.owner_id, r.kind, r.category, r.minutes_before,
              r.days_without_visit, r.send_time
         FROM reminder_rules r
         JOIN reminder_settings s ON s.tenant_id = r.owner_id AND s.enabled
        WHERE r.is_active ${tenantId ? 'AND r.owner_id = $1' : ''}`,
      tenantId ? [tenantId] : [],
    );
    let planned = 0;
    for (const rule of rules) {
      try {
        planned += await this.planRule(rule, now);
      } catch (error) {
        this.logger.error(`Regla ${rule.id} (${rule.kind}): ${error.message}`);
      }
    }
    return planned;
  }

  private async planRule(
    rule: {
      id: string;
      owner_id: string;
      kind: ReminderKind;
      category: ReminderCategory;
      minutes_before: number | null;
      days_without_visit: number | null;
      send_time: string | null;
    },
    now: Date,
  ): Promise<number> {
    const insert = `INSERT INTO reminder_deliveries
        (owner_id, rule_id, kind, client_id, appointment_id, target_id,
         occurrence_key, status, reason, scheduled_for, next_attempt_at, category)`;
    const onConflict = `ON CONFLICT (rule_id, target_id, occurrence_key) DO NOTHING RETURNING id`;
    const base = [rule.owner_id, rule.id, rule.category, now];
    const zoned = [...base, defaultBusinessTimeZone()];
    const sendTime = rule.send_time ?? DEFAULT_SEND_TIME;
    let rows: unknown[] = [];

    switch (rule.kind) {
      case 'before_appointment':
        // Citas que ya entraron en su momento de recordatorio y aún no empiezan.
        // Agendada después de ese momento: no tiene sentido (BOOKED_AFTER).
        rows = await this.dataSource.query(
          `${insert}
           SELECT a.owner_id, $2::uuid, 'before_appointment', a."clientId", a.id, a.id,
                  to_char(a."date" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  CASE WHEN a.created_at > a."date" - make_interval(mins => $5::int)
                       THEN 'skipped' ELSE 'queued' END,
                  CASE WHEN a.created_at > a."date" - make_interval(mins => $5::int)
                       THEN '${R.bookedAfter}' END,
                  a."date" - make_interval(mins => $5::int),
                  a."date" - make_interval(mins => $5::int),
                  $3
             FROM appointments a
            WHERE a.owner_id = $1
              AND a.status::text IN ('PENDING', 'CONFIRMED')
              AND NOT a.needs_reschedule AND a.send_reminder
              AND a."clientId" IS NOT NULL
              AND a."date" > $4
              AND a."date" - make_interval(mins => $5::int) <= $4
           ${onConflict}`,
          [...base, rule.minutes_before],
        );
        break;
      case 'maintenance':
        // Día de la cita completada + N días, a la hora de la regla (zona del
        // negocio). Nada si el cliente volvió a agendar ese servicio.
        rows = await this.dataSource.query(
          `${insert}
           SELECT a.owner_id, $2::uuid, 'maintenance', a."clientId", a.id, a.id,
                  s.id::text, 'queued', NULL, d.due, d.due, $3
             FROM appointments a
             JOIN appointment_services l ON l.appointment_id = a.id
             JOIN services s ON s.id = l.service_id AND s.maintenance_days IS NOT NULL
             CROSS JOIN LATERAL (SELECT ${TZ('a', '$5')} AS tz) z
             CROSS JOIN LATERAL (
               SELECT (((a."date" AT TIME ZONE z.tz)::date + s.maintenance_days)
                        + $6::time) AT TIME ZONE z.tz AS due) d
            WHERE a.owner_id = $1 AND a.status::text = 'COMPLETED'
              AND a."clientId" IS NOT NULL
              AND d.due <= $4 AND d.due > $4 - make_interval(days => ${LATE_TOLERANCE_DAYS})
              AND NOT EXISTS (
                SELECT 1 FROM appointments f
                  JOIN appointment_services fl ON fl.appointment_id = f.id
                 WHERE f.owner_id = a.owner_id AND f."clientId" = a."clientId"
                   AND fl.service_id = s.id AND f.status::text <> 'CANCELLED'
                   AND f."date" > a."date")
           ${onConflict}`,
          [...zoned, sendTime],
        );
        break;
      case 'birthday':
        // Hoy (zona del negocio) es su cumpleaños y ya pasó la hora. El 29 de
        // febrero se celebra el 28 en los años no bisiestos.
        rows = await this.dataSource.query(
          `${insert}
           SELECT c.owner_id, $2::uuid, 'birthday', c.id, NULL, c.id,
                  to_char(n.local, 'YYYY'), 'queued', NULL, n.due, n.due, $3
             FROM clients c
             CROSS JOIN LATERAL (SELECT ${TZ('c', '$5')} AS tz) z
             CROSS JOIN LATERAL (
               SELECT ($4::timestamptz AT TIME ZONE z.tz) AS local,
                      (c.birthday AT TIME ZONE z.tz) AS born,
                      ((($4::timestamptz AT TIME ZONE z.tz)::date + $6::time) AT TIME ZONE z.tz) AS due) n
            WHERE c.owner_id = $1 AND c.birthday IS NOT NULL AND c."isActive"
              AND n.due <= $4
              AND (
                (extract(month FROM n.born), extract(day FROM n.born))
                  = (extract(month FROM n.local), extract(day FROM n.local))
                OR (extract(month FROM n.born) = 2 AND extract(day FROM n.born) = 29
                    AND extract(month FROM n.local) = 2 AND extract(day FROM n.local) = 28
                    AND extract(day FROM (date_trunc('year', n.local) + interval '1 month 28 days')) <> 29)
              )
           ${onConflict}`,
          [...zoned, sendTime],
        );
        break;
      case 'win_back':
        // Última visita (cita completada) hace N días y nada agendado después.
        rows = await this.dataSource.query(
          `${insert}
           SELECT c.owner_id, $2::uuid, 'win_back', c.id, NULL, c.id,
                  to_char(v.last AT TIME ZONE z.tz, 'YYYY-MM-DD'), 'queued', NULL, d.due, d.due, $3
             FROM clients c
             JOIN LATERAL (
               SELECT max(a."date") AS last FROM appointments a
                WHERE a.owner_id = c.owner_id AND a."clientId" = c.id
                  AND a.status::text = 'COMPLETED') v ON v.last IS NOT NULL
             CROSS JOIN LATERAL (SELECT ${TZ('c', '$5')} AS tz) z
             CROSS JOIN LATERAL (
               SELECT (((v.last AT TIME ZONE z.tz)::date + $7::int) + $6::time) AT TIME ZONE z.tz AS due) d
            WHERE c.owner_id = $1 AND c."isActive"
              AND d.due <= $4 AND d.due > $4 - make_interval(days => ${LATE_TOLERANCE_DAYS})
              AND NOT EXISTS (
                SELECT 1 FROM appointments f
                 WHERE f.owner_id = c.owner_id AND f."clientId" = c.id
                   AND f.status::text <> 'CANCELLED' AND f."date" > v.last)
           ${onConflict}`,
          [...zoned, sendTime, rule.days_without_visit],
        );
        break;
    }
    return rows.length;
  }

  // ------------------------------------------------------------------- enviar

  /** Toma entregas vencidas para este proceso (lease): otro no las toma a la vez. */
  private async claim(now: Date, tenantId?: string): Promise<string[]> {
    const result = await this.dataSource.query(
      `UPDATE reminder_deliveries d
          SET next_attempt_at = $1::timestamptz + make_interval(mins => ${DISPATCH_LEASE_MINUTES}),
              updated_at = now()
        WHERE d.id IN (
          SELECT id FROM reminder_deliveries
           WHERE status = 'queued' AND next_attempt_at <= $1
             ${tenantId ? 'AND owner_id = $2' : ''}
           ORDER BY next_attempt_at
           LIMIT ${DISPATCH_BATCH}
           FOR UPDATE SKIP LOCKED)
        RETURNING d.id`,
      tenantId ? [now, tenantId] : [now],
    );
    return returnedRows<{ id: string }>(result).map((r) => r.id);
  }

  private async dispatchOne(
    id: string,
    now: Date,
  ): Promise<'sent' | 'skipped' | 'failed' | 'retried' | 'deferred'> {
    const context = await this.loadContext(id);
    if (!context) return 'skipped';
    const outcome = this.evaluate(context, now);

    if (outcome.status === 'skipped') {
      await this.finish(id, { status: 'skipped', reason: outcome.reason });
      return 'skipped';
    }
    if (outcome.status === 'deferred') {
      await this.dataSource.query(
        `UPDATE reminder_deliveries SET next_attempt_at = $2, updated_at = now() WHERE id = $1`,
        [id, outcome.until],
      );
      return 'deferred';
    }

    const { phone, values, timeZone } = outcome;
    const template = META_TEMPLATES[context.kind];
    const body = renderTemplate(context.template ?? '', values);
    const templateName = context.meta_template_name || template.name;

    if (!(await this.quota.consume(context.owner_id, now, timeZone))) {
      await this.finish(id, {
        status: 'skipped',
        reason: R.quota,
        phone,
        body,
      });
      await this.noticeQuotaExhausted(context.owner_id, now, timeZone);
      return 'skipped';
    }

    const attempts = context.attempts + 1;
    try {
      const { providerMessageId } = await this.channel.send({
        to: phone,
        kind: context.kind,
        category: context.category,
        templateName,
        language: META_TEMPLATE_LANGUAGE,
        params: template.params.map((name) => values[name] ?? ''),
        text: body,
      });
      await this.dataSource.query(
        `UPDATE reminder_deliveries
            SET status = 'sent', reason = NULL, attempts = $2, phone = $3, body = $4,
                template_name = $5, provider_message_id = $6, sent_at = $7,
                last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [id, attempts, phone, body, templateName, providerMessageId, now],
      );
      return 'sent';
    } catch (error) {
      await this.quota.release(context.owner_id, now, timeZone);
      const retryable = error instanceof ChannelError ? error.retryable : true;
      const message =
        error instanceof ChannelError ? error.message : 'Error del canal';
      if (retryable && attempts < MAX_ATTEMPTS) {
        const wait = RETRY_BACKOFF_MINUTES[attempts - 1];
        await this.dataSource.query(
          `UPDATE reminder_deliveries
              SET attempts = $2, last_error = $3, phone = $4, body = $5,
                  template_name = $6,
                  next_attempt_at = $7::timestamptz + make_interval(mins => $8::int),
                  updated_at = now()
            WHERE id = $1`,
          [id, attempts, message, phone, body, templateName, now, wait],
        );
        return 'retried';
      }
      await this.finish(id, {
        status: 'failed',
        reason: retryable ? R.maxAttempts : R.provider,
        phone,
        body,
        attempts,
        lastError: message,
        failedAt: now,
      });
      return 'failed';
    }
  }

  /** Reglas de envío de una entrega (pura salvo `now`): saltar, esperar o enviar. */
  evaluate(c: DeliveryContext, now: Date): Outcome {
    const skip = (reason: string): Outcome => ({ status: 'skipped', reason });
    if (!c.enabled) return skip(R.remindersDisabled);
    if (!c.rule_id || !c.rule_active) return skip(R.ruleDisabled);
    if (!c.client_id || c.client_active === false) return skip(R.optedOut);

    const timeZone = c.timezone || defaultBusinessTimeZone();
    let appointmentStart: Date | null = null;
    if (c.kind === 'before_appointment') {
      if (
        !c.appt_date ||
        !['PENDING', 'CONFIRMED'].includes(c.appt_status ?? '') ||
        c.needs_reschedule ||
        !c.send_reminder ||
        new Date(c.appt_date).toISOString() !== c.occurrence_key
      ) {
        return skip(R.appointmentChanged);
      }
      appointmentStart = new Date(c.appt_date);
      if (now.getTime() >= appointmentStart.getTime()) return skip(R.tooLate);
    } else {
      if (c.rebooked) return skip(R.alreadyBooked);
      const lateMs = LATE_TOLERANCE_DAYS * 86_400_000;
      if (now.getTime() - new Date(c.scheduled_for).getTime() > lateMs) {
        return skip(R.stale);
      }
    }

    if (c.whatsapp_opt_out_at || c.wa_enabled === false)
      return skip(R.optedOut);
    const needsOptIn = c.category === 'marketing' || UTILITY_REQUIRES_OPT_IN;
    if (needsOptIn && !c.whatsapp_opt_in) return skip(R.noConsent);

    const phone = toE164(c.phone, c.country_code, timeZone);
    if (!phone) return skip(R.invalidPhone);

    const window: SendWindow = {
      start: c.send_window_start ?? DEFAULT_WINDOW.start,
      end: c.send_window_end ?? DEFAULT_WINDOW.end,
    };
    if (!insideWindow(now, window, timeZone)) {
      const next = nextAllowedTime(now, window, timeZone);
      if (appointmentStart && next.getTime() >= appointmentStart.getTime()) {
        return skip(R.tooLate);
      }
      if (c.kind === 'birthday') {
        const day = (d: Date) => {
          const p = zonedParts(d, timeZone);
          return `${p.year}-${p.month}-${p.day}`;
        };
        if (day(next) !== day(new Date(c.scheduled_for)))
          return skip(R.tooLate);
      }
      return { status: 'deferred', until: next };
    }

    const apptTz = c.appt_tz || timeZone;
    return {
      status: 'send',
      phone,
      timeZone,
      values: {
        cliente: c.client_name,
        negocio: c.business_name || 'tu negocio',
        servicio: c.service_names,
        fecha: appointmentStart
          ? formatBusinessLongDate(appointmentStart, apptTz)
          : '',
        hora: appointmentStart
          ? formatBusinessTime(appointmentStart, apptTz)
          : '',
        profesional: c.professional_name,
        link_reserva: bookingUrl(c.slug) ?? '',
      },
    };
  }

  private async loadContext(id: string): Promise<DeliveryContext | null> {
    const [row] = await this.dataSource.query(
      `SELECT d.id, d.owner_id, d.kind, d.category, d.occurrence_key, d.scheduled_for,
              d.attempts, d.client_id, d.appointment_id, d.rule_id,
              r.is_active AS rule_active, r.template, r.meta_template_name,
              s.enabled, s.send_window_start, s.send_window_end,
              b.timezone, b.name AS business_name, b.slug,
              c.name AS client_name, c.phone, c."countryCode" AS country_code,
              c."isActive" AS client_active, c."enableWhatsAppNotifications" AS wa_enabled,
              c.whatsapp_opt_in, c.whatsapp_opt_out_at,
              a."date" AS appt_date, a.status::text AS appt_status, a.needs_reschedule,
              a.send_reminder, a.timezone AS appt_tz,
              p.name AS professional_name,
              CASE WHEN d.kind = 'maintenance'
                   THEN (SELECT sv.name FROM services sv WHERE sv.id::text = d.occurrence_key)
                   ELSE (SELECT string_agg(sv.name, ', ' ORDER BY sv.name)
                           FROM appointment_services l JOIN services sv ON sv.id = l.service_id
                          WHERE l.appointment_id = a.id)
              END AS service_names,
              CASE
                WHEN d.kind = 'maintenance' THEN EXISTS (
                  SELECT 1 FROM appointments f
                    JOIN appointment_services fl ON fl.appointment_id = f.id
                   WHERE f.owner_id = d.owner_id AND f."clientId" = d.client_id
                     AND fl.service_id::text = d.occurrence_key
                     AND f.status::text <> 'CANCELLED' AND f."date" > a."date")
                WHEN d.kind = 'win_back' THEN EXISTS (
                  SELECT 1 FROM appointments f
                   WHERE f.owner_id = d.owner_id AND f."clientId" = d.client_id
                     AND f.status::text <> 'CANCELLED'
                     AND f."date" > (d.occurrence_key::date + 1)::timestamp AT TIME ZONE
                         COALESCE(b.timezone, $2))
                ELSE false
              END AS rebooked
         FROM reminder_deliveries d
         LEFT JOIN reminder_rules r ON r.id = d.rule_id
         LEFT JOIN reminder_settings s ON s.tenant_id = d.owner_id
         LEFT JOIN business_settings b ON b.tenant_id = d.owner_id
         LEFT JOIN clients c ON c.id = d.client_id
         LEFT JOIN appointments a ON a.id = d.appointment_id
         LEFT JOIN users p ON p.id = a.professional_id
        WHERE d.id = $1 AND d.status = 'queued'`,
      [id, defaultBusinessTimeZone()],
    );
    return row ?? null;
  }

  private async finish(
    id: string,
    f: {
      status: 'skipped' | 'failed';
      reason: string;
      phone?: string;
      body?: string;
      attempts?: number;
      lastError?: string;
      failedAt?: Date;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE reminder_deliveries
          SET status = $2, reason = $3, phone = COALESCE($4, phone),
              body = COALESCE($5, body), attempts = COALESCE($6, attempts),
              last_error = COALESCE($7, last_error), failed_at = $8, updated_at = now()
        WHERE id = $1`,
      [
        id,
        f.status,
        f.reason,
        f.phone ?? null,
        f.body ?? null,
        f.attempts ?? null,
        f.lastError ?? null,
        f.failedAt ?? null,
      ],
    );
  }

  /** Aviso interno al Owner, una vez por mes, de que se acabó el cupo. */
  private async noticeQuotaExhausted(
    tenantId: string,
    now: Date,
    timeZone: string,
  ): Promise<void> {
    if (!(await this.quota.claimExhaustedNotice(tenantId, now, timeZone)))
      return;
    const repo = this.dataSource.getRepository(Notification);
    await repo.save(
      repo.create({
        receiver_id: tenantId,
        receiver_type: ReceiverType.USER,
        type: NotificationType.GENERAL,
        title: 'Cupo de WhatsApp agotado',
        message:
          'Se acabaron los mensajes automáticos de WhatsApp de este mes. Los recordatorios se pueden seguir enviando a mano desde la app.',
        metadata: { reason: R.quota },
      }),
    );
  }
}
