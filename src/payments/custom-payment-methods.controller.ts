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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/interfaces';

@Controller('custom-payment-methods')
export class CustomPaymentMethodsController {
  constructor(
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
  ) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(
    @Body() createDto: CreateCustomPaymentMethodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customPaymentMethodsService.create(createDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@CurrentUser() user: AuthUser) {
    return this.customPaymentMethodsService.findAll(user.id);
  }

  @Get('active')
  @hasRoles(JwtRoles.Owner)
  findAllActive(@CurrentUser() user: AuthUser) {
    return this.customPaymentMethodsService.findAllActive(user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customPaymentMethodsService.findOne(id, user.id);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateCustomPaymentMethodDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customPaymentMethodsService.update(id, updateDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customPaymentMethodsService.remove(id, user.id);
  }
}
