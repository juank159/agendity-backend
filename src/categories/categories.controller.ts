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
import { Category } from './entities/category.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtPayload } from 'src/auth/interfaces';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from 'src/auth/jwt/jwt.roles.guard';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post()
  create(
    @GetUser() user: JwtPayload,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(createCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get()
  findAll(@GetUser() user: JwtPayload) {
    return this.categoriesService.findAll(user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get(':term')
  findOne(@Param('term') term: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.findOne(term, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @GetUser() user: JwtPayload,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.remove(id, user.id);
  }
}
