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
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { JwtPayload } from 'src/auth/interfaces';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  create(
    @GetUser() user: JwtPayload,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(createCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get()
  findAll(@GetUser() user: JwtPayload) {
    return this.categoriesService.findAll(user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get(':term')
  findOne(@Param('term') term: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.findOne(term, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @GetUser() user: JwtPayload,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: JwtPayload) {
    return this.categoriesService.remove(id, user.id);
  }
}
