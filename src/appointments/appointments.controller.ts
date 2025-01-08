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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
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

@ApiTags('Citas')
@ApiBearerAuth()
@Controller('appointments')
@UseGuards(JwtAuthGuard, JwtRolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Crear una nueva cita' })
  @ApiResponse({
    status: 201,
    description: 'Cita creada exitosamente',
    type: Appointment,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o profesional no disponible',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente, profesional o servicio no encontrado',
  })
  create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @GetUser() user: User,
  ) {
    return this.appointmentsService.create(createAppointmentDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Obtener todas las citas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de citas del negocio',
    type: [Appointment],
  })
  findAll(@GetUser() user: User) {
    return this.appointmentsService.findAll(user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Obtener una cita por ID' })
  @ApiResponse({
    status: 200,
    description: 'Cita encontrada',
    type: Appointment,
  })
  @ApiResponse({
    status: 404,
    description: 'Cita no encontrada',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.appointmentsService.findOne(id, user.id);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Actualizar una cita' })
  @ApiResponse({
    status: 200,
    description: 'Cita actualizada',
    type: Appointment,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o profesional no disponible',
  })
  @ApiResponse({
    status: 404,
    description: 'Cita no encontrada',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @GetUser() user: User,
  ) {
    return this.appointmentsService.update(id, updateAppointmentDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar una cita' })
  @ApiResponse({
    status: 200,
    description: 'Cita eliminada',
  })
  @ApiResponse({
    status: 404,
    description: 'Cita no encontrada',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.appointmentsService.remove(id, user.id);
  }
}
