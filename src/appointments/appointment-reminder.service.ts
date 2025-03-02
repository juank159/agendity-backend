// src/appointments/appointment-reminder.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CronJob } from 'cron';
import { format, subHours, isAfter, addHours, subMinutes } from 'date-fns';
import { es } from 'date-fns/locale';
import { AppointmentStatus } from '../common/enums/status.enum';
import { OnEvent } from '@nestjs/event-emitter';

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
    this.logger.log('Ejecutando tarea diaria de programación de recordatorios');
    await this.scheduleUpcomingReminders();
  }

  // Busca y programa recordatorios para citas próximas
  private async scheduleUpcomingReminders() {
    try {
      const currentDate = new Date();
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      this.logger.log(
        `Buscando citas entre ${currentDate.toISOString()} y ${tomorrow.toISOString()}`,
      );

      // Usar Between de TypeORM para el rango de fechas
      const upcomingAppointments = await this.appointmentsRepository.find({
        where: {
          date: Between(currentDate, tomorrow),
          reminderSent: false, // Solo las que no han sido enviadas
          status: AppointmentStatus.PENDING, // Solo citas confirmadas
        },
        relations: ['client', 'professional', 'services'],
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

  public async sendManualReminder(appointmentId: string, userId: string) {
    try {
      const appointment = await this.appointmentsRepository.findOne({
        where: { id: appointmentId, ownerId: userId },
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

      // Calcular la hora del recordatorio (5 minutos antes de la cita)
      const appointmentDate = new Date(appointment.date);
      const reminderTime = subMinutes(appointmentDate, 5);
      const now = new Date();

      this.logger.log(
        `Cita ${appointment.id} programada para: ${appointmentDate.toISOString()}`,
      );
      this.logger.log(
        `Recordatorio para cita ${appointment.id} calculado para: ${reminderTime.toISOString()}`,
      );
      this.logger.log(`Hora actual: ${now.toISOString()}`);

      // VERIFICACIÓN CRÍTICA: Si el recordatorio ya pasó o está muy cerca
      if (
        reminderTime <= now ||
        reminderTime.getTime() - now.getTime() < 60000
      ) {
        // Menos de 1 minuto en el futuro
        this.logger.warn(
          `El tiempo de recordatorio para la cita ${appointment.id} ya pasó o está muy cerca (${reminderTime.toISOString()}). No se programará un cron job.`,
        );

        // Si la cita aún no ha ocurrido, enviar el recordatorio inmediatamente
        if (appointmentDate > now) {
          this.logger.log(
            `Enviando recordatorio inmediatamente para cita próxima ${appointment.id}`,
          );
          await this.sendReminderNow(appointment);
        } else {
          this.logger.log(
            `La cita ${appointment.id} ya pasó, no se enviará recordatorio`,
          );
        }

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
      const message = `👋 Hola ${appointment.client.name}, le recordamos su cita para *${serviceName}* programada para *${dateStr}* a las *${timeStr}*. Lo esperamos en nuestra ubicación habitual. Si necesita reagendar, por favor contáctenos.`;

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
      const message = `👋 Hola ${appointment.client.name}, le recordamos su cita para *${serviceName}* programada para *${dateStr}* a las *${timeStr}*. Lo esperamos en nuestra ubicación habitual.`;

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
