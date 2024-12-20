import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';

@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo rol' })
  @ApiResponse({ 
    status: 201, 
    description: 'El rol ha sido creado exitosamente',
    type: Role 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Datos de entrada inválidos' 
  })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los roles' })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de todos los roles',
    //type: [Role]
  })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un rol por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID del rol',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Rol encontrado',
    type: Role
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Rol no encontrado'
  })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un rol' })
  @ApiParam({
    name: 'id',
    description: 'ID del rol a actualizar',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Rol actualizado exitosamente',
    type: Role
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Rol no encontrado'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Datos de actualización inválidos'
  })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.update(+id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un rol' })
  @ApiParam({
    name: 'id',
    description: 'ID del rol a eliminar',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Rol eliminado exitosamente'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Rol no encontrado'
  })
  remove(@Param('id') id: string) {
    return this.rolesService.remove(+id);
  }
}