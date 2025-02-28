// src/appointments/appointment-reminder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CronJob } from 'cron';
import { format, subHours, isAfter, addHours } from 'date-fns';
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
    // Inicializar recordatorios al inicio de la aplicación
    this.initializeReminders();
  }

  // Se ejecuta cuando arranca la aplicación
  private async initializeReminders() {
    this.logger.log('Initializing appointment reminders');
    try {
      // Programar recordatorios para citas futuras
      await this.scheduleUpcomingReminders();
    } catch (error) {
      this.logger.error(
        `Error initializing reminders: ${error.message}`,
        error.stack,
      );
    }
  }

  // Se ejecuta todos los días a la medianoche
  @Cron('0 0 * * *')
  async scheduleDailyReminders() {
    this.logger.log('Running daily reminder scheduling task');
    await this.scheduleUpcomingReminders();
  }

  // Busca y programa recordatorios para citas próximas
  private async scheduleUpcomingReminders() {
    try {
      const currentDate = new Date();
      const tomorrow = new Date(currentDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      // Ahora incluimos el campo reminderSent
      const upcomingAppointments = await this.appointmentsRepository.find({
        where: {
          date: Between(currentDate, tomorrow),
          status: AppointmentStatus.CONFIRMED,
          reminderSent: false, // Solo citas que no han recibido recordatorio
        },
        relations: ['client', 'professional', 'services'],
      });

      this.logger.log(
        `Found ${upcomingAppointments.length} upcoming appointments for reminders`,
      );

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

  // Programa un recordatorio para una cita específica
  private async scheduleAppointmentReminder(appointment: Appointment) {
    try {
      if (!appointment.client?.phone) {
        this.logger.warn(
          `Cannot schedule reminder for appointment ${appointment.id}: Client has no phone number`,
        );
        return;
      }

      // Calcular la hora del recordatorio (1 hora antes de la cita)
      const appointmentDate = new Date(appointment.date);
      const reminderTime = subHours(appointmentDate, 1);

      // Si la hora del recordatorio ya pasó, no hacer nada
      if (isAfter(new Date(), reminderTime)) {
        this.logger.log(
          `Reminder time already passed for appointment ${appointment.id}`,
        );
        return;
      }

      // Crear un nombre único para este trabajo
      const jobName = `reminder-${appointment.id}`;

      // Verificar si ya existe un trabajo programado para esta cita
      try {
        const existingJob = this.schedulerRegistry.getCronJob(jobName);
        if (existingJob) {
          this.logger.log(
            `Reminder already scheduled for appointment ${appointment.id}`,
          );
          return;
        }
      } catch (e) {
        // No existe, continuamos
      }

      // Crear un nuevo trabajo programado
      const job = new CronJob(reminderTime, async () => {
        this.logger.log(
          `Executing scheduled reminder for appointment ${appointment.id}`,
        );
        await this.sendAppointmentReminder(appointment);

        // Eliminar el trabajo después de su ejecución
        try {
          this.schedulerRegistry.deleteCronJob(jobName);
        } catch (e) {
          this.logger.error(`Error removing job ${jobName}: ${e.message}`);
        }
      });

      // Registrar y comenzar el trabajo
      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();

      this.logger.log(
        `Scheduled reminder for appointment ${appointment.id} at ${reminderTime.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Error scheduling reminder for appointment ${appointment.id}: ${error.message}`,
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

  // Método para enviar un recordatorio manual
  async sendManualReminder(appointmentId: string, userId: string) {
    try {
      const appointment = await this.appointmentsRepository.findOne({
        where: { id: appointmentId, ownerId: userId },
        relations: ['client', 'professional', 'services'],
      });

      if (!appointment) {
        throw new Error(`Appointment with ID ${appointmentId} not found`);
      }

      return await this.sendAppointmentReminder(appointment);
    } catch (error) {
      this.logger.error(
        `Error sending manual reminder: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
