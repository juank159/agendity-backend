import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { AvailableSlotsQueryDto } from './dto/available-slots-query.dto';
import { SLOT_STEP_MINUTES } from './appointment-slot';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AuthUser } from '../auth/interfaces';
import { appointmentScopeOf } from './appointment-scope';
import { QueryDate } from '../common/decorators/query-date.decorator';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly appointmentReminderService: AppointmentReminderService,
  ) {}

  @Post()
  // El cupo (trial o plan) se consume en la transacción que crea la cita (service, 2.03).
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    // Employee: solo para sí mismo (alcance con professionalId = su id, 2.15).
    return this.appointmentsService.create(
      createAppointmentDto,
      appointmentScopeOf(user),
    );
  }

  /**
   * Recordatorio manual (D-05): devuelve teléfono del cliente (por la cita),
   * texto y enlace `wa.me`. No envía ni marca nada; tras abrir WhatsApp la app
   * llama a `mark-sent`. Owner: citas del negocio; Employee: solo las suyas.
   */
  @Post(':id/send-reminder')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async sendAppointmentReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentReminderService.prepareManualReminder(
      id,
      appointmentScopeOf(user),
    );
  }

  @Patch(':id/reminder/mark-sent')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async markReminderAsSent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const sentAt = await this.appointmentsService.markReminderAsSent(
      id,
      appointmentScopeOf(user),
    );
    return {
      success: true,
      message: 'Recordatorio marcado como enviado',
      appointmentId: id,
      sentAt,
    };
  }

  /**
   * Citas del negocio. Un Employee (que no es Owner) solo ve las suyas
   * (`professionalId = su id`); el Owner ve todas las del negocio.
   * `startDate`/`endDate` opcionales (2.34): citas que empiezan en
   * `[startDate, endDate)`. ISO con offset = ese instante; sin offset = hora
   * del negocio; `endDate` solo fecha incluye ese día entero.
   */
  @Get()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async findAll(
    @CurrentUser() user: AuthUser,
    @QueryDate('startDate', { optional: true }) startDate?: Date,
    @QueryDate('endDate', { optional: true, rangeEnd: true }) endDate?: Date,
  ) {
    return this.appointmentsService.findAll(
      appointmentScopeOf(user),
      startDate,
      endDate,
    );
  }

  // Las rutas estáticas van ANTES de ':id' (si no, ':id' + ParseUUIDPipe las captura con 400).
  /**
   * Fuerza ahora la pasada del cron de recordatorios, SOLO para el negocio de
   * quien llama (antes disparaba los de todos los negocios). Idempotente: lo ya
   * procesado no se repite. La app no la usa.
   */
  @Get('check-reminders')
  @hasRoles(JwtRoles.Owner)
  async checkReminders(@Tenant() tenantId: string) {
    const result = await this.appointmentReminderService.processDueReminders(
      new Date(),
      tenantId,
    );
    return {
      message: 'Reminder check completed',
      processed: result.processed.length,
    };
  }

  /**
   * Inicios libres (ISO con el offset de la zona del tenant) de un profesional en un día
   * del negocio para los servicios pedidos (2.14). Misma regla que al agendar.
   * Owner: cualquier profesional del negocio; Employee: solo su agenda (403).
   */
  @Get('available-slots')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findAvailableSlots(
    @Query() query: AvailableSlotsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    // El día se interpreta en la zona del tenant, en el service (6.02).
    return this.appointmentsService.findAvailableSlots(
      {
        professionalId: query.professional_id,
        date: query.date,
        serviceIds: query.service_ids,
        stepMinutes: query.step ?? SLOT_STEP_MINUTES.default,
      },
      appointmentScopeOf(user),
    );
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.findOne(id, appointmentScopeOf(user));
  }

  /**
   * Cancela la cita (PENDING o CONFIRMED). Owner: cualquier cita del negocio;
   * Employee: solo las suyas (las ajenas dan 404). Final: no se reactiva.
   */
  @Patch(':id/cancel')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.cancel(
      id,
      appointmentScopeOf(user),
      dto.cancellation_reason,
    );
  }

  /**
   * Completa la cita desde PENDING (sin pagar, 2.15) o CONFIRMED; COMPLETED
   * es un no-op y CANCELLED, 409. Mismo alcance que cancelar.
   */
  @Patch(':id/complete')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.complete(id, appointmentScopeOf(user));
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @Tenant() tenantId: string,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, tenantId);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.appointmentsService.remove(id, tenantId);
  }
}
