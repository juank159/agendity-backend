// src/payments/custom-payment-methods.controller.ts
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
import { CustomPaymentMethodsService } from './custom-payment-methods.service';
import { CreateCustomPaymentMethodDto } from './dto/create-custom-payment-method.dto';
import { UpdateCustomPaymentMethodDto } from './dto/update-custom-payment-method.dto';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { Tenant } from '../common/decorators/tenant.decorator';

@Controller('custom-payment-methods')
export class CustomPaymentMethodsController {
  constructor(
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
  ) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(
    @Body() createDto: CreateCustomPaymentMethodDto,
    @Tenant() tenantId: string,
  ) {
    return this.customPaymentMethodsService.create(createDto, tenantId);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@Tenant() tenantId: string) {
    return this.customPaymentMethodsService.findAll(tenantId);
  }

  @Get('active')
  @hasRoles(JwtRoles.Owner)
  findAllActive(@Tenant() tenantId: string) {
    return this.customPaymentMethodsService.findAllActive(tenantId);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.customPaymentMethodsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateCustomPaymentMethodDto,
    @Tenant() tenantId: string,
  ) {
    return this.customPaymentMethodsService.update(id, updateDto, tenantId);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  remove(@Param('id', ParseUUIDPipe) id: string, @Tenant() tenantId: string) {
    return this.customPaymentMethodsService.remove(id, tenantId);
  }
}
