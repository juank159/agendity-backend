// src/subscriptions/controllers/subscriptions.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
} from '@nestjs/common';

import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { JwtAuthGuard } from '../../auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from '../../auth/jwt/jwt.roles.guard';
import { hasRoles } from '../../auth/jwt/has.roles';
import { JwtRoles } from '../../auth/jwt/jwt.role';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { User } from '../../users/entities/user.entity';
import { SubscriptionsService } from '../services/subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // Endpoints para planes de suscripción - solo accesibles para Admin
  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post('plans')
  createPlan(@Body() createPlanDto: CreateSubscriptionPlanDto) {
    return this.subscriptionsService.createPlan(createPlanDto);
  }

  @Get('plans')
  getAllPlans() {
    return this.subscriptionsService.getAllPlans();
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.subscriptionsService.getPlanById(id);
  }

  @hasRoles(JwtRoles.Admin)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Patch('plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body() updatePlanDto: UpdateSubscriptionPlanDto,
  ) {
    return this.subscriptionsService.updatePlan(id, updatePlanDto);
  }

  // Endpoints para suscripciones de tenants
  @UseGuards(JwtAuthGuard)
  @Get('status')
  getSubscriptionStatus(@GetUser() user: User) {
    return this.subscriptionsService.getSubscriptionByTenantId(user.tenant_id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('check-limits')
  checkSubscriptionLimits(@GetUser() user: User) {
    return this.subscriptionsService.checkSubscriptionStatus(user.tenant_id);
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post('subscribe')
  subscribe(
    @GetUser() user: User,
    @Body() createSubscriptionDto: CreateSubscriptionDto,
  ) {
    // Asegurar que el tenant_id en el DTO coincida con el del usuario
    createSubscriptionDto.tenant_id = user.tenant_id;

    return this.subscriptionsService.createPaidSubscription(
      createSubscriptionDto,
      user.email,
      `${user.name} ${user.lastname}`,
      user.phone, // Añadido para Wompi
    );
  }

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Post('cancel')
  @HttpCode(200)
  cancelSubscription(@GetUser() user: User) {
    return this.subscriptionsService.cancelSubscription(user.tenant_id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payment-history')
  getPaymentHistory(@GetUser() user: User) {
    return this.subscriptionsService.getPaymentHistory(user.tenant_id);
  }
}
