// src/appointments/appointment-reminder.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { whatsappLink } from '../whatsapp/whatsapp-phone';
import { AppointmentStatus } from '../common/enums/status.enum';
import { AppointmentScope } from './appointment-scope';
import {
  formatBusinessLongDate,
  formatBusinessTime,
} from '../common/utils/date.util';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/constants/error-codes';
import {
  Notification,
  NotificationType,
  ReceiverType,
} from '../notifications/entities/notification.entity';

/**
 * Recordatorios de cita (2.09a, D-05).
 *
 * - **Al cliente**: solo MANUAL. El Owner o el Employee abre `wa.me` desde la
 *   app (`POST :id/send-reminder` le da el enlace con el teléfono del cliente
 *   por su id) y registra el envío con `PATCH :id/reminder/mark-sent`
 *   (`reminderSent`). El envío automático por un proveedor está en pausa (2.09b).
 * - **Automático (cron por minuto)**: busca en la BD las citas `PENDING` o
 *   `CONFIRMED` que entraron en su ventana y aún no se procesaron, y deja una
 *   notificación interna al profesional (tabla `notifications`). Opcional, con
 *   `REMINDER_OWNER_WHATSAPP=true`: aviso por CallMeBot al número del propio
 *   Owner. Nunca escribe al cliente.
 */

/** Estados a los que se les recuerda la cita (CLAUDE.md §1). */
export const REMINDER_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

/** Mayor antelación posible: el cron solo mira la próxima hora. */
export const MAX_REMINDER_LEAD_MINUTES = 60;

/**
 * Minutos de antelación del recordatorio según cuánto faltaba para la cita
 * cuando se agendó: ≥ 24 h → 60; ≥ 2 h → 30; menos → 15. Todo con instantes
 * (sin zona).
 */
export function reminderLeadMinutes(appointmentDate: Date, now: Date): number {
  const hoursUntil = (appointmentDate.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntil >= 24) return 60;
  if (hoursUntil >= 2) return 30;
  return 15;
}

/** Instante en que toca el recordatorio de una cita agendada en `now`. */
export function reminderTimeFor(appointmentDate: Date, now: Date): Date {
  return new Date(
    appointmentDate.getTime() -
      reminderLeadMinutes(appointmentDate, now) * 60_000,
  );
}

export function isReminderStatus(status: AppointmentStatus): boolean {
  return REMINDER_STATUSES.includes(status);
}

/**
 * ¿Le toca ya el recordatorio automático? Ventana [fecha − antelación, fecha):
 * la antelación (60/30/15) sale de cuánto faltaba al agendarla (`createdAt`).
 * Si el servidor estuvo caído al abrirse la ventana, se envía al volver
 * mientras la cita no haya empezado; una cita que ya empezó no se recuerda.
 */
export function isReminderDue(
  appointment: { date: Date; createdAt: Date },
  now: Date,
): boolean {
  const start = appointment.date.getTime();
  if (now.getTime() >= start) return false;
  const bookedAt =
    appointment.createdAt.getTime() <= now.getTime()
      ? appointment.createdAt
      : now;
  return now.getTime() >= reminderTimeFor(appointment.date, bookedAt).getTime();
}

/**
 * Regla 2.18 (usuario): mover la cita a OTRA fecha reinicia el recordatorio
 * manual (`reminderSent=false`, `reminderSentAt=null`) para que vuelva a la
 * lista de pendientes de la app. Mismo instante u otros cambios: nada.
 * El automático no hace falta tocarlo: `auto_reminder_for` deja de coincidir
 * con la fecha nueva.
 */
export function manualReminderResetOnReschedule(
  previousDate: Date,
  nextDate: Date | undefined,
): Pick<Appointment, 'reminderSent' | 'reminderSentAt'> | null {
  if (!nextDate || nextDate.getTime() === new Date(previousDate).getTime()) {
    return null;
  }
  return { reminderSent: false, reminderSentAt: null };
}

/** El cron corre salvo en los tests (`NODE_ENV=test`) o con `REMINDERS_CRON_ENABLED=false`. */
export function remindersCronEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== 'test' && env.REMINDERS_CRON_ENABLED !== 'false';
}

/** Aviso por CallMeBot al Owner: APAGADO salvo `REMINDER_OWNER_WHATSAPP=true` (D-05). */
export function ownerWhatsappEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.REMINDER_OWNER_WHATSAPP === 'true';
}

type ReminderAppointment = Pick<Appointment, 'date' | 'services'> & {
  client?: Pick<Appointment['client'], 'name'> | null;
};

function serviceNames(appointment: Pick<Appointment, 'services'>): string {
  return appointment.services?.length
    ? appointment.services.map((s) => s.name).join(', ')
    : 'servicio programado';
}

function clientFullName(client?: { name?: string; lastname?: string }): string {
  return [client?.name, client?.lastname].filter(Boolean).join(' ').trim();
}

/** Texto del recordatorio AL CLIENTE, con día y hora en la zona del negocio. */
export function reminderMessage(appointment: ReminderAppointment): string {
  const appointmentDate = new Date(appointment.date);
  const dateStr = formatBusinessLongDate(appointmentDate);
  const timeStr = formatBusinessTime(appointmentDate);
  const greeting = appointment.client?.name
    ? `👋 Hola ${appointment.client.name},`
    : '👋 Hola,';
  return `${greeting} te recordamos tu cita para *${serviceNames(appointment)}* programada para *${dateStr}* a las *${timeStr}*. Te esperamos en nuestra ubicación habitual.`;
}

/** Texto de la notificación interna (profesional) y del aviso opcional al Owner. */
export function staffReminderMessage(appointment: Appointment): string {
  const date = new Date(appointment.date);
  const client = clientFullName(appointment.client) || 'tu cliente';
  const pending = appointment.reminderSent
    ? ''
    : ' Aún no se le ha enviado el recordatorio por WhatsApp.';
  return `Cita con ${client} (${serviceNames(appointment)}) el ${formatBusinessLongDate(date)} a las ${formatBusinessTime(date)}.${pending}`;
}

/** Cita candidata leída por el cron (SQL crudo). */
interface ReminderCandidate {
  id: string;
  date: Date;
  createdAt: Date;
}

export interface ReminderRunResult {
  /** Citas en la próxima hora sin recordatorio procesado. */
  checked: number;
  /** Ids procesados en esta pasada (cada uno una sola vez en su vida para esa fecha). */
  processed: string[];
}

/** Lo que necesita la app para abrir `wa.me` (recordatorio manual). */
export interface ManualReminder {
  appointmentId: string;
  clientId: string;
  phone: string;
  message: string;
  whatsappUrl: string;
}

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);
  /** Evita dos pasadas solapadas en el mismo proceso (entre procesos, lo evita el UPDATE condicional). */
  private running = false;

  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentsRepository: Repository<Appointment>,
    private readonly dataSource: DataSource,
    private readonly whatsappService: WhatsappService,
  ) {}

  /** Cada minuto. Sustituye a los `CronJob` en memoria y a la limpieza cada 6 h. */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'appointment-reminders' })
  async runDueReminders(): Promise<void> {
    if (!remindersCronEnabled() || this.running) return;
    this.running = true;
    try {
      await this.processDueReminders(new Date());
    } catch (error) {
      this.logger.error(
        `Error procesando recordatorios: ${error.message}`,
        error.stack,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Procesa los recordatorios que tocan en `now`. Con `tenantId`, solo los de
   * ese negocio (`GET /appointments/check-reminders`). Idempotente: cada cita
   * se procesa una vez por fecha, aunque se llame varias veces o en paralelo.
   */
  async processDueReminders(
    now: Date,
    tenantId?: string,
  ): Promise<ReminderRunResult> {
    if (tenantId !== undefined && !tenantId) {
      throw new Error('processDueReminders: tenantId vacío');
    }
    const candidates = await this.findCandidates(now, tenantId);
    const processed: string[] = [];

    for (const candidate of candidates) {
      if (!isReminderDue(candidate, now)) continue;
      try {
        const appointment = await this.dataSource.transaction((manager) =>
          this.claimAndNotify(manager, candidate),
        );
        if (!appointment) continue;
        processed.push(appointment.id);
        if (ownerWhatsappEnabled()) await this.notifyOwnerSafely(appointment);
      } catch (error) {
        this.logger.error(
          `Error en el recordatorio de la cita ${candidate.id}: ${error.message}`,
          error.stack,
        );
      }
    }

    if (processed.length) {
      this.logger.log(`Recordatorios procesados: ${processed.length}`);
    }
    return { checked: candidates.length, processed };
  }

  /** Citas de la próxima hora, en estado recordable y sin recordatorio procesado para su fecha. */
  private async findCandidates(
    now: Date,
    tenantId?: string,
  ): Promise<ReminderCandidate[]> {
    const until = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);
    const params: unknown[] = [REMINDER_STATUSES, now, until];
    let tenantFilter = '';
    if (tenantId) {
      params.push(tenantId);
      tenantFilter = 'AND a.owner_id = $4';
    }
    return this.appointmentsRepository.query(
      `SELECT a.id, a."date" AS "date", a.created_at AS "createdAt"
         FROM appointments a
        WHERE a.status::text = ANY($1::text[])
          AND a.send_reminder
          AND a."date" > $2 AND a."date" <= $3
          AND a.auto_reminder_for IS DISTINCT FROM a."date"
          ${tenantFilter}
        ORDER BY a."date"`,
      params,
    );
  }

  /**
   * Marca la cita como procesada para su fecha con un UPDATE condicional (solo
   * gana una pasada) y, en la misma transacción, deja la notificación interna.
   * Devuelve la cita si esta pasada la procesó; `null` si otra se adelantó o si
   * la cita cambió (fecha, estado o `send_reminder`) desde la consulta.
   */
  private async claimAndNotify(
    manager: EntityManager,
    candidate: ReminderCandidate,
  ): Promise<Appointment | null> {
    const claim = await manager
      .createQueryBuilder()
      .update(Appointment)
      .set({ autoReminderFor: () => '"date"' })
      .where('id = :id', { id: candidate.id })
      // Postgres guarda microsegundos y `Date` solo milisegundos.
      .andWhere(`date_trunc('milliseconds', "date") = :date`, {
        date: candidate.date,
      })
      .andWhere('status IN (:...statuses)', { statuses: REMINDER_STATUSES })
      .andWhere('send_reminder = true')
      .andWhere('auto_reminder_for IS DISTINCT FROM "date"')
      .execute();
    if (!claim.affected) return null;

    const appointment = await manager.getRepository(Appointment).findOne({
      where: { id: candidate.id },
      relations: { client: true, services: true },
    });
    if (!appointment) return null;

    const notifications = manager.getRepository(Notification);
    await notifications.save(
      notifications.create({
        receiver_id: appointment.professionalId,
        receiver_type: ReceiverType.USER,
        type: NotificationType.APPOINTMENT_REMINDER,
        title: 'Recordatorio de cita',
        message: staffReminderMessage(appointment),
        metadata: {
          appointment_id: appointment.id,
          client_id: appointment.client?.id ?? null,
          appointment_date: appointment.date.toISOString(),
          reminder_sent_to_client: appointment.reminderSent,
        },
      }),
    );
    return appointment;
  }

  /** Aviso opcional al Owner por CallMeBot, fuera de la transacción y sin romper la pasada. */
  private async notifyOwnerSafely(appointment: Appointment): Promise<void> {
    try {
      const result = await this.whatsappService.sendToOwner(
        appointment.ownerId,
        `🔔 ${staffReminderMessage(appointment)}`,
      );
      if (!result?.success) {
        this.logger.warn(
          `Aviso al Owner no enviado (cita ${appointment.id}): ${result?.message ?? result?.error}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Aviso al Owner no enviado (cita ${appointment.id}): ${error.message}`,
      );
    }
  }

  /**
   * Recordatorio MANUAL: devuelve el teléfono del cliente (por la relación de
   * la cita, nunca por nombre), el texto y el enlace `wa.me`. No envía nada ni
   * marca la cita: la app abre WhatsApp y después llama a `mark-sent`.
   * Owner: citas del negocio; Employee: solo las suyas (otras → 404).
   */
  async prepareManualReminder(
    appointmentId: string,
    scope: AppointmentScope,
  ): Promise<ManualReminder> {
    const notFound = () =>
      new NotFoundException(`Cita con ID ${appointmentId} no encontrada`);
    if (!scope?.tenantId) throw notFound();

    const appointment = await this.appointmentsRepository.findOne({
      where: {
        id: appointmentId,
        ownerId: scope.tenantId,
        ...(scope.professionalId
          ? { professionalId: scope.professionalId }
          : {}),
      },
      relations: { client: true, services: true },
    });
    if (!appointment) throw notFound();

    if (!isReminderStatus(appointment.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        'Solo se envían recordatorios de citas pendientes o confirmadas',
      );
    }
    if (!appointment.client?.phone?.trim()) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        'El cliente no tiene número de teléfono registrado',
      );
    }

    const message = reminderMessage(appointment);
    return {
      appointmentId: appointment.id,
      clientId: appointment.client.id,
      phone: appointment.client.phone,
      message,
      whatsappUrl: whatsappLink(
        appointment.client.phone,
        message,
        appointment.client.countryCode,
      ),
    };
  }
}
