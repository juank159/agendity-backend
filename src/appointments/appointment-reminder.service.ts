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

  // Programa un recordatorio para una cita específica
  private async scheduleAppointmentReminder(appointment: Appointment) {
    try {
      if (!appointment.client?.phone) {
        this.logger.warn(
          `Cannot schedule reminder for appointment ${appointment.id}: Client has no phone number`,
        );
        return;
      }

      // Calcular la hora del recordatorio (5 minutos antes de la cita)
      const appointmentDate = new Date(appointment.date);
      const reminderTime = subMinutes(appointmentDate, 5);

      this.logger.log(`Cita programada para: ${appointmentDate.toISOString()}`);
      this.logger.log(
        `Recordatorio programado para: ${reminderTime.toISOString()}`,
      );
      this.logger.log(`Hora actual: ${new Date().toISOString()}`);

      // Si la hora del recordatorio ya pasó, verificar si podemos enviar ahora
      if (isAfter(new Date(), reminderTime)) {
        this.logger.log(
          `Hora de recordatorio ya pasó para cita ${appointment.id}, verificando si podemos enviar ahora`,
        );

        const now = new Date();
        const diffMs = appointmentDate.getTime() - now.getTime();
        const diffMinutes = Math.floor(diffMs / 60000);

        this.logger.log(`La cita es en ${diffMinutes} minutos`);

        // Si faltan menos de 15 minutos pero más de 0 para la cita, enviar ahora
        if (diffMinutes <= 15 && diffMinutes > 0) {
          this.logger.log(
            `Enviando recordatorio inmediatamente para cita ${appointment.id}`,
          );
          await this.sendReminderNow(appointment);
        } else {
          this.logger.log(
            `No se enviará recordatorio para cita ${appointment.id}: ${diffMinutes} minutos restantes`,
          );
        }
        return;
      }

      // Crear un nombre único para este trabajo
      const jobName = `reminder-${appointment.id}`;

      // Verificar si ya existe un trabajo programado para esta cita
      try {
        const existingJob = this.schedulerRegistry.getCronJob(jobName);
        if (existingJob) {
          this.logger.log(
            `Recordatorio ya programado para cita ${appointment.id}`,
          );
          return;
        }
      } catch (e) {
        // No existe, continuamos
        this.logger.log(
          `Creando nuevo trabajo programado para cita ${appointment.id}`,
        );
      }

      // Crear un nuevo trabajo programado
      const job = new CronJob(reminderTime, async () => {
        this.logger.log(
          `Ejecutando recordatorio programado para cita ${appointment.id}`,
        );
        await this.sendReminderNow(appointment);

        // Eliminar el trabajo después de su ejecución
        try {
          this.schedulerRegistry.deleteCronJob(jobName);
          this.logger.log(`Trabajo ${jobName} eliminado después de ejecución`);
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
