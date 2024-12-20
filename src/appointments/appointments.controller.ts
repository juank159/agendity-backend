import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { Appointment } from './entities/appointment.entity';

@ApiTags('Citas')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva cita' })
  @ApiResponse({ status: 201, description: 'Cita creada exitosamente', type: Appointment })
  create(@Body() createAppointmentDto: CreateAppointmentDto) {
    return this.appointmentsService.create(createAppointmentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las citas' })
  @ApiResponse({ status: 200, description: 'Lista de citas', type: [Appointment] })
  findAll() {
    return this.appointmentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una cita por ID' })
  @ApiResponse({ status: 200, description: 'Cita encontrada', type: Appointment })
  findOne(@Param('id') id: string) {
    return this.appointmentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una cita' })
  @ApiResponse({ status: 200, description: 'Cita actualizada', type: Appointment })
  update(@Param('id') id: string, @Body() updateAppointmentDto: UpdateAppointmentDto) {
    return this.appointmentsService.update(id, updateAppointmentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una cita' })
  @ApiResponse({ status: 200, description: 'Cita eliminada' })
  remove(@Param('id') id: string) {
    return this.appointmentsService.remove(id);
  }
}