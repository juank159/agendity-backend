// src/payments/custom-payment-methods.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CustomPaymentMethodsService } from './custom-payment-methods.service';
import { CreateCustomPaymentMethodDto } from './dto/create-custom-payment-method.dto';
import { UpdateCustomPaymentMethodDto } from './dto/update-custom-payment-method.dto';
import { JwtAuthGuard } from '../auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from '../auth/jwt/jwt.roles.guard';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { GetUser } from '../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';

@UseGuards(JwtAuthGuard, JwtRolesGuard)
@Controller('custom-payment-methods')
export class CustomPaymentMethodsController {
  constructor(
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
  ) {}

  @Post()
  @hasRoles(JwtRoles.Owner)
  create(
    @Body() createDto: CreateCustomPaymentMethodDto,
    @GetUser() user: User,
  ) {
    return this.customPaymentMethodsService.create(createDto, user.id);
  }

  @Get()
  @hasRoles(JwtRoles.Owner)
  findAll(@GetUser() user: User) {
    return this.customPaymentMethodsService.findAll(user.id);
  }

  @Get('active')
  @hasRoles(JwtRoles.Owner)
  findAllActive(@GetUser() user: User) {
    return this.customPaymentMethodsService.findAllActive(user.id);
  }

  @Get(':id')
  @hasRoles(JwtRoles.Owner)
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.customPaymentMethodsService.findOne(id, user.id);
  }

  @Patch(':id')
  @hasRoles(JwtRoles.Owner)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateCustomPaymentMethodDto,
    @GetUser() user: User,
  ) {
    return this.customPaymentMethodsService.update(id, updateDto, user.id);
  }

  @Delete(':id')
  @hasRoles(JwtRoles.Owner)
  remove(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.customPaymentMethodsService.remove(id, user.id);
  }
}
