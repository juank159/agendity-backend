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
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Service } from './entities/service.entity';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User } from 'src/users/entities/user.entity';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  create(@Body() createServiceDto: CreateServiceDto, @GetUser() user: User) {
    return this.servicesService.create(createServiceDto, user.id);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get()
  findAll(@GetUser() user: User) {
    return this.servicesService.findAll(user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get('category/:categoryId')
  findByCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @GetUser() user: User,
  ) {
    return this.servicesService.findByCategory(categoryId, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.servicesService.findOne(id, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @GetUser() user: User,
  ) {
    return this.servicesService.update(id, updateServiceDto, user.id);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.servicesService.remove(id, user.id);
  }
}
