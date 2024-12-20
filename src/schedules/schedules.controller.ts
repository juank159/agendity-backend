import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { Schedule } from './entities/schedule.entity';

@ApiTags('Horarios')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo horario' })
  @ApiResponse({ status: 201, description: 'Horario creado exitosamente', type: Schedule })
  create(@Body() createScheduleDto: CreateScheduleDto) {
    return this.schedulesService.create(createScheduleDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los horarios' })
  @ApiResponse({ status: 200, description: 'Lista de horarios', type: [Schedule] })
  findAll() {
    return this.schedulesService.findAll();
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Obtener horarios de un profesional' })
  @ApiResponse({ status: 200, description: 'Horarios del profesional', type: [Schedule] })
  findByUser(@Param('userId') userId: string) {
    return this.schedulesService.findByUser(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un horario por ID' })
  @ApiResponse({ status: 200, description: 'Horario encontrado', type: Schedule })
  findOne(@Param('id') id: string) {
    return this.schedulesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un horario' })
  @ApiResponse({ status: 200, description: 'Horario actualizado', type: Schedule })
  update(@Param('id') id: string, @Body() updateScheduleDto: UpdateScheduleDto) {
    return this.schedulesService.update(id, updateScheduleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un horario' })
  @ApiResponse({ status: 200, description: 'Horario eliminado' })
  remove(@Param('id') id: string) {
    return this.schedulesService.remove(id);
  }
}