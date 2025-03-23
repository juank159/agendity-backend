import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
  Query,
  BadRequestException,
  Logger,
  UseInterceptors,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { Appointment } from './entities/appointment.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';
import { AppointmentReminderService } from './appointment-reminder.service';
import { SubscriptionLimitsGuard } from 'src/subscriptions/guards/subscription-limits.guard';
import { SubscriptionLimitInterceptor } from '../subscriptions/interceptors/subscription-limit.interceptor';

@Controller('appointments')
@UseGuards(JwtAuthGuard, JwtRolesGuard)
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly appointmentReminderService: AppointmentReminderService,
  ) {}

  @Post()
  //@UseGuards(JwtAuthGuard, JwtRolesGuard, SubscriptionLimitsGuard)
  //@UseInterceptors(SubscriptionLimitInterceptor)
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @GetUser() user: User,
  ) {
    console.log('=== CREATE APPOINTMENT DEBUG ===');
    console.log('Fecha recibida:', createAppointmentDto.date);
    console.log('DTO completo:', createAppointmentDto);

    // Validar formato ISO 8601
    const date = new Date(createAppointmentDto.date);
    if (isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date format');
    }

    console.log('Fecha parseada:', date);
    return this.appointmentsService.create(createAppointmentDto, user.id);
  }

  @Post(':id/send-reminder')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async sendAppointmentReminder(
    @Param('id') id: string,
    @GetUser() user: User,
  ) {
    return this.appointmentReminderService.sendManualReminder(id, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  async findAll(
    @GetUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      console.log('Received request with params:', {
        userId: user.id,
        startDate,
        endDate,
      });

      let parsedStartDate: Date | undefined;
      let parsedEndDate: Date | undefined;

      if (startDate && endDate) {
        parsedStartDate = new Date(startDate);
        parsedEndDate = new Date(endDate);

        // Validar que las fechas sean válidas
        if (
          isNaN(parsedStartDate.getTime()) ||
          isNaN(parsedEndDate.getTime())
        ) {
          throw new BadRequestException('Fechas inválidas');
        }

        // Validar que startDate no sea mayor que endDate
        if (parsedStartDate > parsedEndDate) {
          throw new BadRequestException(
            'La fecha inicial no puede ser mayor que la fecha final',
          );
        }

        console.log('Parsed dates:', {
          parsedStartDate,
          parsedEndDate,
        });
      }

      const appointments = await this.appointmentsService.findAll(
        user.id,
        parsedStartDate,
        parsedEndDate,
      );

      console.log(`Returning ${appointments.length} appointments`);
      return appointments;
    } catch (error) {
      console.error('Error in findAll controller:', error);
      throw error;
    }
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.appointmentsService.findOne(id, user.id);
  }

  @Get('check-reminders')
  @UseGuards(JwtAuthGuard)
  async checkReminders(@GetUser() user: User) {
    this.logger.log(`Manual reminder check requested by user ${user.id}`);
    await this.appointmentReminderService.checkAndScheduleReminders();
    return { message: 'Reminder check completed' };
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @GetUser() user: User,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.appointmentsService.remove(id, user.id);
  }
}
