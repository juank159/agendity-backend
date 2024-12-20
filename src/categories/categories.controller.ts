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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Category } from './entities/category.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User } from 'src/users/entities/user.entity';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from 'src/auth/jwt/jwt.roles.guard';
import { JwtPayload } from 'src/auth/interfaces';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post()
  @ApiOperation({ summary: 'Crear una nueva categoría' })
  @ApiResponse({
    status: 201,
    description: 'La categoría ha sido creada exitosamente',
    type: Category,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos en la solicitud',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una categoría con el mismo nombre',
  })
  create(
    @GetUser() user: JwtPayload,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(createCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get()
  @ApiOperation({ summary: 'Obtener todas las categorías' })
  @ApiResponse({
    status: 200,
    description: 'Lista de todas las categorías',
    type: [Category],
  })
  findAll(@GetUser() user: JwtPayload) {
    return this.categoriesService.findAll(user.id);
  }

  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get(':term')
  @ApiOperation({ summary: 'Obtener una categoría por ID' })
  @ApiParam({
    name: 'id',
    description: 'ID de la categoría',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'La categoría ha sido encontrada',
    type: Category,
  })
  @ApiResponse({
    status: 404,
    description: 'Categoría no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido (debe ser un UUID)',
  })
  findOne(@Param('term') term: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.findOne(term, user.id);
  }

  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una categoría existente' })
  @ApiParam({
    name: 'id',
    description: 'ID de la categoría a actualizar',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'La categoría ha sido actualizada',
    type: Category,
  })
  @ApiResponse({
    status: 404,
    description: 'Categoría no encontrada',
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe una categoría con el mismo nombre',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos en la solicitud o ID inválido',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @GetUser() user: JwtPayload,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una categoría' })
  @ApiParam({
    name: 'id',
    description: 'ID de la categoría a eliminar',
    type: 'string',
    format: 'uuid',
    example: 'e7cd5752-9c12-4d4b-9c9f-3c0b93b9c467',
  })
  @ApiResponse({
    status: 200,
    description: 'La categoría ha sido eliminada',
  })
  @ApiResponse({
    status: 404,
    description: 'Categoría no encontrada',
  })
  @ApiResponse({
    status: 400,
    description: 'ID inválido (debe ser un UUID)',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.remove(id, user.id);
  }
}
