import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { TimeBlocksService } from './time-blocks.service';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { UpdateTimeBlockDto } from './dto/update-time-block.dto';
import { TimeBlock } from './entities/time-block.entity';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe';
import { TimeBlockResponseDto } from './dto/time-block.response.dto';

@ApiTags('Bloques de Tiempo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, JwtRolesGuard)
@Controller('time-blocks')
export class TimeBlocksController {
  constructor(private readonly timeBlocksService: TimeBlocksService) {}

  @Post()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Crear un nuevo bloque de tiempo' })
  @ApiResponse({
    status: 201,
    description: 'Bloque creado exitosamente',
    type: TimeBlockResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Fechas inválidas o horario no disponible',
  })
  create(
    @GetUser() user: User,
    @Body() createTimeBlockDto: CreateTimeBlockDto,
  ) {
    return this.timeBlocksService.create(createTimeBlockDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener todos los bloques de tiempo' })
  @ApiResponse({
    status: 200,
    description: 'Lista de bloques de tiempo',
    type: [TimeBlockResponseDto],
  })
  findAll(@GetUser() user: User) {
    return this.timeBlocksService.findAll(user.id);
  }

  @Get('user/:userId')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener bloques de tiempo de un profesional' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiResponse({
    status: 200,
    description: 'Bloques de tiempo del profesional',
    type: [TimeBlockResponseDto],
  })
  findByUser(
    @GetUser() user: User,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('startDate', ParseDatePipe) startDate?: Date,
    @Query('endDate', ParseDatePipe) endDate?: Date,
  ) {
    return this.timeBlocksService.findByUser(
      userId,
      startDate,
      endDate,
      user.id,
    );
  }

  @Get('available-slots/:userId')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Obtener slots disponibles para un profesional' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
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
          end: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  getAvailableSlots(
    @GetUser() user: User,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('date', ParseDatePipe) date: Date,
    @Query('duration', ParseIntPipe) duration: number,
  ) {
    return this.timeBlocksService.getAvailableSlots(
      userId,
      date,
      duration,
      user.id,
    );
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Obtener un bloque de tiempo por ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bloque encontrado',
    type: TimeBlockResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Bloque no encontrado' })
  findOne(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.timeBlocksService.findOne(id, user.id);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @ApiOperation({ summary: 'Actualizar un bloque de tiempo' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Bloque actualizado',
    type: TimeBlockResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Bloque no encontrado' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  update(
    @GetUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTimeBlockDto: UpdateTimeBlockDto,
  ) {
    return this.timeBlocksService.update(id, updateTimeBlockDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar un bloque de tiempo' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bloque eliminado' })
  @ApiResponse({ status: 404, description: 'Bloque no encontrado' })
  remove(@GetUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.timeBlocksService.remove(id, user.id);
  }
}
