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
import { format, subHours, isAfter, addHours, subMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { AppointmentStatus } from '../common/enums/status.enum';
import { OnEvent } from '@nestjs/event-emitter';
import { AppointmentScope } from './appointment-scope';

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

  // Se ejecuta todos los días a la medianoche
  @Cron('0 0 * * *') // Ejecutar diariamente a medianoche
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
      // ✅ OPTIMIZACIÓN: Extender rango a próximos 7 días para mejor cobertura
      const nextWeek = new Date(currentDate);
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(23, 59, 59, 999);

      this.logger.log(
        `🔍 Buscando citas futuras entre ${currentDate.toISOString()} y ${nextWeek.toISOString()}`,
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

      // ✅ LÓGICA MEJORADA: Calcular tiempo de recordatorio inteligente
      const appointmentDate = new Date(appointment.date);
      const now = new Date();
      const timeUntilAppointment = appointmentDate.getTime() - now.getTime();
      const hoursUntilAppointment = timeUntilAppointment / (1000 * 60 * 60);

      // ✅ VALIDACIÓN PREVIA: Verificar que la cita sea futura
      if (appointmentDate <= now) {
        this.logger.warn(
          `⏰ Cita ${appointment.id} ya pasó (${appointmentDate.toISOString()}), no se programará recordatorio`,
        );
        return;
      }

      // ✅ TIEMPO DE RECORDATORIO INTELIGENTE basado en cuándo es la cita
      let reminderMinutesBefore: number;
      if (hoursUntilAppointment >= 24) {
        reminderMinutesBefore = 60; // 1 hora antes para citas de mañana o más tarde
      } else if (hoursUntilAppointment >= 2) {
        reminderMinutesBefore = 30; // 30 minutos antes para citas del mismo día
      } else {
        reminderMinutesBefore = 15; // 15 minutos antes para citas muy próximas
      }

      const reminderTime = subMinutes(appointmentDate, reminderMinutesBefore);

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

      // Crear una expresión cron usando la fecha específica
      // Formato: segundo minuto hora día mes día-semana
      const cronExpression = `${reminderTime.getSeconds()} ${reminderTime.getMinutes()} ${reminderTime.getHours()} ${reminderTime.getDate()} ${reminderTime.getMonth() + 1} *`;

      this.logger.log(
        `Expresión cron generada para cita ${appointment.id}: ${cronExpression}`,
      );

      try {
        // Crear un nuevo trabajo cron usando la expresión
        const job = new CronJob(cronExpression, async () => {
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

  // Envía un recordatorio para una cita
  private async sendAppointmentReminder(appointment: Appointment) {
    try {
      if (!appointment.client?.phone) {
        this.logger.warn(`Cannot send reminder: Client has no phone number`);
        return;
      }

      // Formatear fecha y hora para el mensaje
      const appointmentDate = new Date(appointment.date);
      const dateStr = format(appointmentDate, "EEEE d 'de' MMMM", {
        locale: es,
      });
      const timeStr = format(appointmentDate, 'h:mm a');

      // Obtener el nombre del servicio
      let serviceName = 'servicio programado';
      if (appointment.services && appointment.services.length > 0) {
        serviceName = appointment.services.map((s) => s.name).join(', ');
      }

      // Construir el mensaje
      const message = `👋 Hola, te recordamos tu cita para *${serviceName}* programada para *${dateStr}* a las *${timeStr}*. Te esperamos en nuestra ubicación habitual. Si necesita reagendar, por favor contáctenos.`;

      // Enviar el mensaje usando el servicio de WhatsApp
      const result = await this.whatsappService.sendWhatsAppMessage(
        appointment.ownerId,
        appointment.client.phone,
        message,
      );

      if (result.success) {
        this.logger.log(
          `Successfully sent reminder for appointment ${appointment.id}`,
        );

        await this.appointmentsRepository.update(appointment.id, {
          reminderSent: true,
          reminderSentAt: new Date(),
        });
      } else {
        this.logger.warn(
          `Failed to send reminder for appointment ${appointment.id}: ${result.message || result.error}`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error sending reminder for appointment ${appointment.id}: ${error.message}`,
        error.stack,
      );
      throw error;
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

      // Formatear fecha y hora para el mensaje
      const appointmentDate = new Date(appointment.date);
      const dateStr = format(appointmentDate, "EEEE d 'de' MMMM", {
        locale: es,
      });
      const timeStr = format(appointmentDate, 'h:mm a');

      // Obtener el nombre del servicio
      let serviceName = 'servicio programado';
      if (appointment.services && appointment.services.length > 0) {
        serviceName = appointment.services.map((s) => s.name).join(', ');
        this.logger.log(`Servicios para la cita: ${serviceName}`);
      }

      // Construir el mensaje
      const message = `👋 Hola , te recordamos tu cita para *${serviceName}* programada para *${dateStr}* a las *${timeStr}*. Te esperamos en nuestra ubicación habitual.`;

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
