// src/appointments/appointment-reminder.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
  In,
} from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CronJob } from 'cron';
import { AppointmentStatus } from '../common/enums/status.enum';
import { OnEvent } from '@nestjs/event-emitter';
import { AppointmentScope } from './appointment-scope';
import {
  businessTimeZone,
  formatBusinessLongDate,
  formatBusinessTime,
} from '../common/utils/date.util';

/**
 * Minutos de antelación del recordatorio según cuánto falta para la cita:
 * ≥ 24 h → 60; ≥ 2 h → 30; menos → 15. Todo con instantes (sin zona).
 */
export function reminderLeadMinutes(appointmentDate: Date, now: Date): number {
  const hoursUntil = (appointmentDate.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntil >= 24) return 60;
  if (hoursUntil >= 2) return 30;
  return 15;
}

/** Instante en que se envía el recordatorio de una cita. */
export function reminderTimeFor(appointmentDate: Date, now: Date): Date {
  return new Date(
    appointmentDate.getTime() -
      reminderLeadMinutes(appointmentDate, now) * 60_000,
  );
}

/** Texto del recordatorio, con día y hora en la zona del negocio. */
export function reminderMessage(
  appointment: Pick<Appointment, 'date' | 'services'>,
): string {
  const appointmentDate = new Date(appointment.date);
  const dateStr = formatBusinessLongDate(appointmentDate);
  const timeStr = formatBusinessTime(appointmentDate);
  const serviceName = appointment.services?.length
    ? appointment.services.map((s) => s.name).join(', ')
    : 'servicio programado';
  return `👋 Hola , te recordamos tu cita para *${serviceName}* programada para *${dateStr}* a las *${timeStr}*. Te esperamos en nuestra ubicación habitual.`;
}

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);

  constructor(
    @InjectRepository(Appointment)
    private appointmentsRepository: Repository<Appointment>,
    private whatsappService: WhatsappService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    this.logger.log('Inicializando servicio de recordatorios de citas');

    // Inicializar recordatorios al inicio de la aplicación
    this.initializeReminders();
  }

  @OnEvent('appointment.created')
  async handleAppointmentCreatedEvent(appointment: Appointment) {
    this.logger.log(
      `Nueva cita creada, programando recordatorio: ${appointment.id}`,
    );

    try {
      // Asegurarse de que la cita tiene todas las relaciones necesarias
      if (!appointment.client || !appointment.services) {
        const fullAppointment = await this.appointmentsRepository.findOne({
          where: { id: appointment.id },
          relations: ['client', 'professional', 'services'],
        });

        if (fullAppointment) {
          await this.scheduleAppointmentReminder(fullAppointment);
        }
      } else {
        await this.scheduleAppointmentReminder(appointment);
      }
    } catch (error) {
      this.logger.error(
        `Error al programar recordatorio para nueva cita ${appointment.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // Se ejecuta cuando arranca la aplicación
  private async initializeReminders() {
    this.logger.log('Iniciando programación de recordatorios');
    try {
      // Programar recordatorios para todas las citas futuras
      await this.scheduleUpcomingReminders();
      this.logger.log('Programación de recordatorios completada');
    } catch (error) {
      this.logger.error(
        `Error initializing reminders: ${error.message}`,
        error.stack,
      );
    }
  }

  // Todos los días a medianoche, hora del negocio
  @Cron('0 0 * * *', { timeZone: businessTimeZone() })
  async scheduleDailyReminders() {
    this.logger.log(
      '🕐 Ejecutando tarea diaria de programación de recordatorios',
    );
    await this.scheduleUpcomingReminders();
    await this.cleanupExpiredReminders();
  }

  // ✅ NUEVA FUNCIONALIDAD: Limpiar recordatorios de citas pasadas
  @Cron('0 */6 * * *') // Ejecutar cada 6 horas
  async cleanupExpiredReminders() {
    this.logger.log('🧹 Iniciando limpieza de recordatorios expirados');

    try {
      const currentDate = new Date();

      // Buscar citas que ya pasaron pero aún tienen reminderSent: false
      const expiredAppointments = await this.appointmentsRepository.find({
        where: {
          date: LessThanOrEqual(currentDate),
          reminderSent: false,
        },
        select: ['id', 'date', 'reminderSent'],
      });

      this.logger.log(
        `📊 Encontradas ${expiredAppointments.length} citas pasadas sin recordatorio marcado`,
      );

      // Marcar como recordatorio enviado para evitar procesamiento futuro
      if (expiredAppointments.length > 0) {
        const expiredIds = expiredAppointments.map((app) => app.id);

        await this.appointmentsRepository.update(
          { id: In(expiredIds) },
          { reminderSent: true, reminderSentAt: currentDate },
        );

        this.logger.log(
          `✅ Marcadas ${expiredAppointments.length} citas pasadas como procesadas`,
        );
      }

      // Limpiar trabajos cron de citas que ya pasaron
      await this.cleanupExpiredCronJobs();
    } catch (error) {
      this.logger.error(
        `❌ Error durante limpieza de recordatorios: ${error.message}`,
        error.stack,
      );
    }
  }

  // ✅ MÉTODO AUXILIAR: Limpiar trabajos cron expirados
  private async cleanupExpiredCronJobs() {
    try {
      const currentDate = new Date();
      const allJobs = this.schedulerRegistry.getCronJobs();
      let cleanedCount = 0;

      allJobs.forEach((job, jobName) => {
        // Solo procesar trabajos de recordatorios
        if (jobName.startsWith('reminder-')) {
          const appointmentId = jobName.replace('reminder-', '');

          // Verificar si el trabajo debería ser eliminado
          // (esto es una aproximación, idealmente deberíamos verificar con la base de datos)
          try {
            this.schedulerRegistry.deleteCronJob(jobName);
            cleanedCount++;
            this.logger.log(`🗑️ Trabajo cron ${jobName} eliminado`);
          } catch (e) {
            // Trabajo ya no existe o error al eliminar
            this.logger.warn(
              `⚠️ No se pudo eliminar trabajo ${jobName}: ${e.message}`,
            );
          }
        }
      });

      if (cleanedCount > 0) {
        this.logger.log(
          `🧹 Limpieza de trabajos cron completada: ${cleanedCount} eliminados`,
        );
      }
    } catch (error) {
      this.logger.error(`❌ Error limpiando trabajos cron: ${error.message}`);
    }
  }

  // Busca y programa recordatorios para citas próximas
  private async scheduleUpcomingReminders() {
    try {
      const currentDate = new Date();

      this.logger.log(
        `🔍 Buscando citas futuras desde ${currentDate.toISOString()}`,
      );

      // ✅ FILTRO MEJORADO: Solo citas futuras que no han enviado recordatorio
      const upcomingAppointments = await this.appointmentsRepository.find({
        where: {
          date: MoreThanOrEqual(currentDate), // Solo citas futuras
          reminderSent: false, // Solo las que no han sido enviadas
          status: AppointmentStatus.PENDING, // Solo citas confirmadas
        },
        relations: ['client', 'professional', 'services'],
        order: { date: 'ASC' }, // Ordenar por fecha más próxima primero
      });

      this.logger.log(
        `Se encontraron ${upcomingAppointments.length} citas próximas para recordatorios`,
      );

      // Listar todas las citas encontradas con su hora
      upcomingAppointments.forEach((appointment) => {
        this.logger.log(
          `Cita ID: ${appointment.id}, Cliente: ${appointment.client?.name || 'Sin nombre'}, Fecha: ${appointment.date}, Teléfono: ${appointment.client?.phone || 'Sin teléfono'}`,
        );
      });

      // Programar recordatorios para cada cita
      for (const appointment of upcomingAppointments) {
        await this.scheduleAppointmentReminder(appointment);
      }
    } catch (error) {
      this.logger.error(
        `Error scheduling upcoming reminders: ${error.message}`,
        error.stack,
      );
    }
  }

  /** Recordatorio manual de una cita visible para el alcance (negocio y, para el Employee, solo las suyas). */
  public async sendManualReminder(
    appointmentId: string,
    scope: AppointmentScope,
  ) {
    try {
      if (!scope?.tenantId) {
        throw new NotFoundException(
          `Appointment with ID ${appointmentId} not found`,
        );
      }
      const appointment = await this.appointmentsRepository.findOne({
        where: {
          id: appointmentId,
          ownerId: scope.tenantId,
          ...(scope.professionalId
            ? { professionalId: scope.professionalId }
            : {}),
        },
        relations: ['client', 'professional', 'services'],
      });

      if (!appointment) {
        throw new NotFoundException(
          `Appointment with ID ${appointmentId} not found`,
        );
      }

      return await this.sendReminderNow(appointment);
    } catch (error) {
      this.logger.error(
        `Error sending manual reminder for appointment ${appointmentId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // src/appointments/appointment-reminder.service.ts
  // Modifica el método scheduleAppointmentReminder

  public async scheduleAppointmentReminder(appointment: Appointment) {
    try {
      // Verificar si la cita tiene cliente
      if (!appointment.client?.phone) {
        this.logger.warn(
          `Cannot schedule reminder for appointment ${appointment.id}: Client has no phone number`,
        );
        return;
      }

      const appointmentDate = new Date(appointment.date);
      const now = new Date();

      // ✅ VALIDACIÓN PREVIA: Verificar que la cita sea futura
      if (appointmentDate <= now) {
        this.logger.warn(
          `⏰ Cita ${appointment.id} ya pasó (${appointmentDate.toISOString()}), no se programará recordatorio`,
        );
        return;
      }

      const reminderMinutesBefore = reminderLeadMinutes(appointmentDate, now);
      const reminderTime = reminderTimeFor(appointmentDate, now);

      this.logger.log(
        `📅 Cita ${appointment.id} programada para: ${appointmentDate.toISOString()}`,
      );
      this.logger.log(
        `⏰ Recordatorio ${reminderMinutesBefore} min antes: ${reminderTime.toISOString()}`,
      );
      this.logger.log(`🕐 Hora actual: ${now.toISOString()}`);

      // ✅ VERIFICACIÓN MEJORADA: Si el recordatorio ya pasó
      if (reminderTime <= now) {
        this.logger.warn(
          `⚠️ El tiempo de recordatorio para la cita ${appointment.id} ya pasó. Enviando inmediatamente.`,
        );

        // Enviar el recordatorio inmediatamente para citas muy próximas
        await this.sendReminderNow(appointment);
        return;
      }

      // Verificamos si ya existe un trabajo programado para esta cita
      const jobName = `reminder-${appointment.id}`;
      try {
        const existingJob = this.schedulerRegistry.getCronJob(jobName);
        if (existingJob) {
          this.logger.log(
            `Recordatorio ya programado para cita ${appointment.id}, se omitirá`,
          );
          return;
        }
      } catch (e) {
        // No existe, continuamos
        this.logger.log(
          `Creando nuevo trabajo programado para cita ${appointment.id}`,
        );
      }

      try {
        // Un `Date` como cronTime = una sola ejecución en ese instante (sin
        // depender de la zona del proceso ni repetirse al año siguiente).
        const job = new CronJob(reminderTime, async () => {
          this.logger.log(
            `Ejecutando recordatorio programado para cita ${appointment.id}`,
          );
          await this.sendReminderNow(appointment);

          // Eliminar el trabajo después de su ejecución
          try {
            this.schedulerRegistry.deleteCronJob(jobName);
            this.logger.log(
              `Trabajo ${jobName} eliminado después de ejecución`,
            );
          } catch (e) {
            this.logger.error(
              `Error removiendo trabajo ${jobName}: ${e.message}`,
            );
          }
        });

        // Registrar y comenzar el trabajo
        this.schedulerRegistry.addCronJob(jobName, job);
        job.start();

        this.logger.log(
          `Recordatorio programado para cita ${appointment.id} a las ${reminderTime.toISOString()}`,
        );
      } catch (cronError) {
        this.logger.error(
          `Error al programar cron job para cita ${appointment.id}: ${cronError.message}`,
        );

        // Si hay un error al programar el cron pero la cita aún está en el futuro,
        // intentamos un enfoque alternativo con setTimeout
        if (appointmentDate > now) {
          const timeUntilReminder = reminderTime.getTime() - now.getTime();
          if (timeUntilReminder > 0) {
            this.logger.log(
              `Usando setTimeout como alternativa para cita ${appointment.id}`,
            );
            setTimeout(async () => {
              this.logger.log(
                `Ejecutando recordatorio con setTimeout para cita ${appointment.id}`,
              );
              await this.sendReminderNow(appointment);
            }, timeUntilReminder);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Error programando recordatorio para cita ${appointment.id}: ${error.message}`,
        error.stack,
      );
    }
  }

  public async checkAndScheduleReminders() {
    this.logger.log('Checking and scheduling reminders manually');
    return this.scheduleUpcomingReminders();
  }

  // Método para enviar un recordatorio manual
  private async sendReminderNow(appointment: Appointment) {
    try {
      this.logger.log(
        `Iniciando envío de recordatorio para cita ${appointment.id}`,
      );

      if (!appointment.client?.phone) {
        this.logger.warn(
          `No se puede enviar recordatorio: Cliente no tiene número de teléfono`,
        );
        return;
      }

      this.logger.log(`Teléfono del cliente: ${appointment.client.phone}`);

      // Mensaje con día y hora en la zona del negocio
      const message = reminderMessage(appointment);

      this.logger.log(`Mensaje a enviar: ${message}`);

      // Enviar el mensaje usando el servicio de WhatsApp
      this.logger.log(
        `Enviando mensaje a WhatsApp para owner ${appointment.ownerId}`,
      );
      const result = await this.whatsappService.sendWhatsAppMessage(
        appointment.ownerId,
        appointment.client.phone,
        message,
      );

      this.logger.log(`Resultado del envío: ${JSON.stringify(result)}`);

      if (result.success) {
        this.logger.log(
          `Recordatorio enviado correctamente para cita ${appointment.id}`,
        );

        // Actualizar el estado del recordatorio
        await this.appointmentsRepository.update(appointment.id, {
          reminderSent: true,
          reminderSentAt: new Date(),
        });
        this.logger.log(`Estado de cita actualizado: reminderSent=true`);
      } else {
        this.logger.warn(
          `Error al enviar recordatorio para cita ${appointment.id}: ${result.message || result.error}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error enviando recordatorio para cita ${appointment.id}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
