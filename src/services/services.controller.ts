import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Service } from './entities/service.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User } from 'src/users/entities/user.entity';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from 'src/auth/jwt/jwt.roles.guard';

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post()
  @ApiOperation({ summary: 'Crear un nuevo servicio' })
  @ApiResponse({
    status: 201,
    description: 'El servicio ha sido creado exitosamente',
    type: Service,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos en la solicitud',
  })
  @ApiResponse({
    status: 404,
    description: 'Categoría no encontrada',
  })
  create(@Body() createServiceDto: CreateServiceDto, @GetUser() user: User) {
    return this.servicesService.create(createServiceDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get()
  @ApiOperation({ summary: 'Obtener todos los servicios' })
  @ApiResponse({
    status: 200,
    description: 'Lista de todos los servicios disponibles',
    type: [Service],
  })
  findAll(@GetUser() user: User) {
    return this.servicesService.findAll(user.id);
  }
  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get('category/:categoryId')
  @ApiOperation({ summary: 'Obtener servicios por categoría' })
  @ApiParam({
    name: 'categoryId',
    description: 'ID de la categoría a buscar',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de servicios de la categoría especificada',
    type: [Service],
  })
  @ApiResponse({
    status: 404,
    description: 'Categoría no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'ID de categoría inválido',
  })
  findByCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @GetUser() user: User,
  ) {
    return this.servicesService.findByCategory(categoryId, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un servicio por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio encontrado',
    type: Service,
  })
  @ApiResponse({
    status: 404,
    description: 'Servicio no encontrado',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.servicesService.findOne(id, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un servicio existente' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio a actualizar',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio actualizado exitosamente',
    type: Service,
  })
  @ApiResponse({
    status: 404,
    description: 'Servicio no encontrado',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos en la solicitud',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @GetUser() user: User,
  ) {
    return this.servicesService.update(id, updateServiceDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un servicio' })
  @ApiParam({
    name: 'id',
    description: 'ID del servicio a eliminar',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio eliminado exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Servicio no encontrado',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.servicesService.remove(id, user.id);
  }
}
