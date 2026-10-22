import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { UserServicesService } from './user-services.service';
import { AssignServiceDto } from './dto/assign-service.dto';
import { UserService } from './entities/user-service.entity';
import { Tenant } from '../common/decorators/tenant.decorator';

@ApiTags('Servicios de Usuario')
@Controller('users/:userId/services')
export class UserServicesController {
  constructor(private readonly userServicesService: UserServicesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  @ApiOperation({ summary: 'Asignar un servicio a un usuario' })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario al que se asignará el servicio',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 201,
    description: 'Servicio asignado exitosamente',
    type: UserService,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos de entrada inválidos o UUID inválido',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario o servicio no encontrado',
  })
  assignService(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() assignServiceDto: AssignServiceDto,
    @Tenant() tenantId: string,
  ) {
    return this.userServicesService.assignService(
      userId,
      assignServiceDto,
      tenantId,
    );
  }

  // Nuevo endpoint para asignar múltiples servicios
  @hasRoles(JwtRoles.Owner)
  @Post('batch')
  @ApiOperation({ summary: 'Asignar múltiples servicios a un usuario' })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario al que se asignarán los servicios',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 201,
    description: 'Servicios asignados exitosamente',
    type: [UserService],
  })
  assignMultipleServices(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() assignServicesDto: AssignServiceDto[],
    @Tenant() tenantId: string,
  ) {
    return this.userServicesService.assignMultipleServices(
      userId,
      assignServicesDto,
      tenantId,
    );
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get()
  @ApiOperation({ summary: 'Obtener todos los servicios de un usuario' })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario del cual se obtendrán los servicios',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de servicios del usuario',
    type: [UserService],
  })
  @ApiResponse({
    status: 400,
    description: 'UUID inválido',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado',
  })
  getUserServices(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Tenant() tenantId: string,
  ) {
    return this.userServicesService.getUserServices(userId, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':serviceId')
  @ApiOperation({ summary: 'Eliminar un servicio asignado a un usuario' })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario',
    type: 'string',
    format: 'uuid',
  })
  @ApiParam({
    name: 'serviceId',
    description: 'ID del servicio a eliminar',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio eliminado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'UUID inválido',
  })
  @ApiResponse({
    status: 404,
    description: 'Usuario o servicio no encontrado',
  })
  removeService(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Tenant() tenantId: string,
  ) {
    return this.userServicesService.removeService(userId, serviceId, tenantId);
  }
}
