import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  ParseArrayPipe,
} from '@nestjs/common';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import {
  CreateScheduleBatchItemDto,
  CreateScheduleDto,
} from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { Schedule } from './entities/schedule.entity';
import { Tenant } from '../common/decorators/tenant.decorator';

@ApiTags('Horarios')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  @ApiOperation({ summary: 'Crear un nuevo horario' })
  @ApiResponse({
    status: 201,
    description: 'Horario creado exitosamente',
    type: Schedule,
  })
  create(
    @Body() createScheduleDto: CreateScheduleDto,
    @Tenant() tenantId: string,
  ) {
    return this.schedulesService.create(createScheduleDto, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('batch/:userId')
  @ApiOperation({ summary: 'Crear múltiples horarios para un usuario' })
  @ApiResponse({
    status: 201,
    description: 'Horarios creados exitosamente',
    type: [Schedule],
  })
  createBatch(
    @Param('userId', ParseUUIDPipe) userId: string,
    // El ValidationPipe global no valida arrays: cada elemento con su DTO (2.17).
    @Body(
      new ParseArrayPipe({
        items: CreateScheduleBatchItemDto,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    schedules: CreateScheduleBatchItemDto[],
    @Tenant() tenantId: string,
  ) {
    return this.schedulesService.createBatch(userId, schedules, tenantId);
  }

  // Vista global de todos los negocios: solo Admin. Para un negocio: GET /schedules/user/:userId.
  @hasRoles(JwtRoles.Admin)
  @Get()
  @ApiOperation({ summary: 'Obtener todos los horarios' })
  @ApiResponse({
    status: 200,
    description: 'Lista de horarios',
    type: [Schedule],
  })
  findAll() {
    return this.schedulesService.findAllForAdmin();
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get('user/:userId')
  @ApiOperation({ summary: 'Obtener horarios de un profesional' })
  @ApiResponse({
    status: 200,
    description: 'Horarios del profesional',
    type: [Schedule],
  })
  findByUser(@Param('userId') userId: string, @Tenant() tenantId: string) {
    return this.schedulesService.findByUser(userId, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un horario por ID' })
  @ApiResponse({
    status: 200,
    description: 'Horario encontrado',
    type: Schedule,
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.schedulesService.findOne(id, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un horario' })
  @ApiResponse({
    status: 200,
    description: 'Horario actualizado',
    type: Schedule,
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
    @Tenant() tenantId: string,
  ) {
    return this.schedulesService.update(id, updateScheduleDto, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un horario' })
  @ApiResponse({ status: 200, description: 'Horario eliminado' })
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.schedulesService.remove(id, tenantId);
  }
}
