import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TimeBlocksService } from './time-blocks.service';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { UpdateTimeBlockDto } from './dto/update-time-block.dto';
import { TimeBlock } from './entities/time-block.entity';

@ApiTags('Bloques de Tiempo')
@Controller('time-blocks')
export class TimeBlocksController {
  constructor(private readonly timeBlocksService: TimeBlocksService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo bloque de tiempo' })
  @ApiResponse({ status: 201, description: 'Bloque creado exitosamente', type: TimeBlock })
  create(@Body() createTimeBlockDto: CreateTimeBlockDto) {
    return this.timeBlocksService.create(createTimeBlockDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los bloques de tiempo' })
  @ApiResponse({ status: 200, description: 'Lista de bloques de tiempo', type: [TimeBlock] })
  findAll() {
    return this.timeBlocksService.findAll();
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Obtener bloques de tiempo de un profesional' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiResponse({ status: 200, description: 'Bloques de tiempo del profesional', type: [TimeBlock] })
  findByUser(
    @Param('userId') userId: string,
    @Query('startDate') startDate?: Date,
    @Query('endDate') endDate?: Date
  ) {
    return this.timeBlocksService.findByUser(userId, startDate, endDate);
  }

  @Get('available-slots/:userId')
  @ApiOperation({ summary: 'Obtener slots disponibles para un profesional' })
  @ApiQuery({ name: 'date', required: true, type: Date })
  @ApiQuery({ name: 'duration', required: true, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Slots disponibles',
    schema: {
      type: 'array',
      items: {
        properties: {
          start: { type: 'string', format: 'date-time' },
          end: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  getAvailableSlots(
    @Param('userId') userId: string,
    @Query('date') date: Date,
    @Query('duration') duration: number
  ) {
    return this.timeBlocksService.getAvailableSlots(userId, date, duration);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un bloque de tiempo por ID' })
  @ApiResponse({ status: 200, description: 'Bloque encontrado', type: TimeBlock })
  findOne(@Param('id') id: string) {
    return this.timeBlocksService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un bloque de tiempo' })
  @ApiResponse({ status: 200, description: 'Bloque actualizado', type: TimeBlock })
  update(@Param('id') id: string, @Body() updateTimeBlockDto: UpdateTimeBlockDto) {
    return this.timeBlocksService.update(id, updateTimeBlockDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un bloque de tiempo' })
  @ApiResponse({ status: 200, description: 'Bloque eliminado' })
  remove(@Param('id') id: string) {
    return this.timeBlocksService.remove(id);
  }
}