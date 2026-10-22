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
import { Tenant } from 'src/common/decorators/tenant.decorator';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @hasRoles(JwtRoles.Owner)
  @Post()
  create(
    @Body() createServiceDto: CreateServiceDto,
    @Tenant() tenantId: string,
  ) {
    return this.servicesService.create(createServiceDto, tenantId);
  }

  // Lecturas del catálogo: Owner y Employee (el empleado ve el catálogo de su negocio). Escrituras: solo Owner.
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get()
  findAll(@Tenant() tenantId: string) {
    return this.servicesService.findAll(tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get('category/:categoryId')
  findByCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Tenant() tenantId: string,
  ) {
    return this.servicesService.findByCategory(categoryId, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.servicesService.findOne(id, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
    @Tenant() tenantId: string,
  ) {
    return this.servicesService.update(id, updateServiceDto, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.servicesService.remove(id, tenantId);
  }
}
