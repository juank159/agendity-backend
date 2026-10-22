import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Tenant } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { AppointmentReminderService } from './appointment-reminder.service';
import { AuthUser } from '../auth/interfaces';
import { appointmentScopeOf } from './appointment-scope';

@Controller('appointments')
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly appointmentReminderService: AppointmentReminderService,
  ) {}

  @Post()
  // El cupo (trial o plan) se consume en la transacción que crea la cita (service, 2.03).
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @Tenant() tenantId: string,
  ) {
    // Validar formato ISO 8601
    const date = new Date(createAppointmentDto.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }
    return this.appointmentsService.create(createAppointmentDto, tenantId);
  }

  @Post(':id/send-reminder')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async sendAppointmentReminder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentReminderService.sendManualReminder(
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
    await this.appointmentsService.markReminderAsSent(
      id,
      appointmentScopeOf(user),
    );
    this.logger.log(`Recordatorio marcado como enviado para la cita ${id}`);
    return {
      success: true,
      message: 'Recordatorio marcado como enviado',
      appointmentId: id,
      sentAt: new Date(),
    };
  }

  /**
   * Citas del negocio. Un Employee (que no es Owner) solo ve las suyas
   * (`professionalId = su id`); el Owner ve todas las del negocio.
   * Los query `startDate`/`endDate` que manda la app se ignoran (como antes:
   * el filtro por fechas nunca se implementó en esta ruta).
   */
  @Get()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async findAll(@CurrentUser() user: AuthUser) {
    return this.appointmentsService.findAll(appointmentScopeOf(user));
  }

  // Las rutas estáticas van ANTES de ':id' (si no, ':id' + ParseUUIDPipe las captura con 400).
  @Get('check-reminders')
  async checkReminders(@CurrentUser() user: AuthUser) {
    this.logger.log(`Manual reminder check requested by user ${user.id}`);
    await this.appointmentReminderService.checkAndScheduleReminders();
    return { message: 'Reminder check completed' };
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.appointmentsService.findOne(id, appointmentScopeOf(user));
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
