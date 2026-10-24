import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
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
import { Tenant } from '../common/decorators/tenant.decorator';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe';
import { TimeBlockResponseDto } from './dto/time-block.response.dto';

@ApiTags('Bloques de Tiempo')
@ApiBearerAuth()
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
    @Tenant() tenantId: string,
    @Body() createTimeBlockDto: CreateTimeBlockDto,
  ) {
    return this.timeBlocksService.create(createTimeBlockDto, tenantId);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Obtener todos los bloques de tiempo' })
  @ApiResponse({
    status: 200,
    description: 'Lista de bloques de tiempo',
    type: [TimeBlockResponseDto],
  })
  findAll(@Tenant() tenantId: string) {
    return this.timeBlocksService.findAll(tenantId);
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
    @Tenant() tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('startDate', new ParseDatePipe({ optional: true })) startDate?: Date,
    @Query('endDate', new ParseDatePipe({ optional: true })) endDate?: Date,
  ) {
    return this.timeBlocksService.findByUser(
      userId,
      startDate,
      endDate,
      tenantId,
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
  findOne(@Tenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.timeBlocksService.findOne(id, tenantId);
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
    @Tenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTimeBlockDto: UpdateTimeBlockDto,
  ) {
    return this.timeBlocksService.update(id, updateTimeBlockDto, tenantId);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  @ApiOperation({ summary: 'Eliminar un bloque de tiempo' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Bloque eliminado' })
  @ApiResponse({ status: 404, description: 'Bloque no encontrado' })
  remove(@Tenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.timeBlocksService.remove(id, tenantId);
  }
}
