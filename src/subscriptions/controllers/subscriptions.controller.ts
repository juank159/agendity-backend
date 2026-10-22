import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  HttpCode,
} from '@nestjs/common';

import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { hasRoles } from '../../auth/jwt/has.roles';
import { JwtRoles } from '../../auth/jwt/jwt.role';
import { Tenant } from '../../common/decorators/tenant.decorator';
import { SubscriptionsService } from '../services/subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // Endpoints para planes de suscripción - solo accesibles para Admin
  @hasRoles(JwtRoles.Admin)
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
  @Patch('plans/:id')
  updatePlan(
    @Param('id') id: string,
    @Body() updatePlanDto: UpdateSubscriptionPlanDto,
  ) {
    return this.subscriptionsService.updatePlan(id, updatePlanDto);
  }

  // Suscripción del negocio: el tenant sale siempre de la sesión (@Tenant(), §5).

  /** Lectura: no crea el trial ni marca `expired` (estado efectivo al vuelo). */
  @Get('status')
  getSubscriptionStatus(@Tenant() tenantId: string) {
    return this.subscriptionsService.getSubscriptionStatus(tenantId);
  }

  /** Lectura: `{ canCreateAppointment, message, code? }` sin escribir. */
  @Get('check-limits')
  checkSubscriptionLimits(@Tenant() tenantId: string) {
    return this.subscriptionsService.checkSubscriptionStatus(tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('subscribe')
  subscribe(
    @Tenant() tenantId: string,
    @Body() createSubscriptionDto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.createPaidSubscription(
      tenantId,
      createSubscriptionDto,
    );
  }

  @hasRoles(JwtRoles.Owner)
  @Post('refresh-status')
  @HttpCode(200)
  refreshSubscriptionStatus(@Tenant() tenantId: string) {
    return this.subscriptionsService.refreshPendingSubscription(tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('cancel')
  @HttpCode(200)
  cancelSubscription(@Tenant() tenantId: string) {
    return this.subscriptionsService.cancelSubscription(tenantId);
  }

  @Get('payment-history')
  getPaymentHistory(@Tenant() tenantId: string) {
    return this.subscriptionsService.getPaymentHistory(tenantId);
  }
}
