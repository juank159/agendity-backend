import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';
import { Tenant } from 'src/common/decorators/tenant.decorator';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  create(
    @Tenant() tenantId: string,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(createCategoryDto, tenantId);
  }

  // Lecturas: Owner y Employee (catálogo de su negocio). Escrituras: solo Owner.
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get()
  findAll(@Tenant() tenantId: string) {
    return this.categoriesService.findAll(tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get(':term')
  findOne(@Param('term') term: string, @Tenant() tenantId: string) {
    return this.categoriesService.findOne(term, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Tenant() tenantId: string,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.categoriesService.remove(id, tenantId);
  }
}
