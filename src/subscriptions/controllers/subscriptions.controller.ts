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
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import { WompiService } from '../services/wompi.service';

@Controller('subscriptions')
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
    private readonly configService: ConfigService,
  ) {}

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

  @UseGuards(JwtAuthGuard)
  @Post('refresh-status')
  @HttpCode(200)
  async refreshSubscriptionStatus(@GetUser() user: User) {
    try {
      // Obtener el tenant_id
      const tenantId = user?.tenant_id;

      this.logger.log(
        `Refrescando estado de suscripción para tenant ${tenantId}`,
      );

      // Manejo especial para entorno de desarrollo cuando tenantId es undefined
      if (!tenantId) {
        this.logger.warn(
          'refreshSubscriptionStatus llamado sin tenant_id válido',
        );

        // En desarrollo, activar la suscripción aunque no haya tenant_id
        if (this.configService.get<string>('NODE_ENV') !== 'production') {
          this.logger.log(
            'Ambiente de desarrollo detectado: buscando suscripción pendiente',
          );

          try {
            // Intentar encontrar la última suscripción pendiente
            const subscriptions =
              await this.subscriptionsService.getAllSubscriptions();
            const pendingSubscription = subscriptions
              .filter((s) => s.status === 'pending')
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime(),
              )[0];

            if (pendingSubscription) {
              this.logger.log(
                `Ambiente de desarrollo: Activando suscripción ${pendingSubscription.id} automáticamente`,
              );

              // Registrar un pago simulado
              await this.subscriptionsService.recordPayment(
                pendingSubscription.tenant_id,
                pendingSubscription.id,
                pendingSubscription.plan
                  ? pendingSubscription.plan.price
                  : 27000, // Valor del plan o valor predeterminado
                'COP',
                'successful',
                `dev_${Date.now()}`,
                '',
              );

              // Actualizar la suscripción a activa
              await this.subscriptionsService.handleSubscriptionUpdated(
                pendingSubscription.id,
                'ACTIVE',
              );

              return {
                success: true,
                message: 'Suscripción activada en modo desarrollo',
                subscription: pendingSubscription,
              };
            } else {
              this.logger.warn(
                'No se encontró ninguna suscripción pendiente para activar',
              );
              return {
                success: false,
                message: 'No hay suscripciones pendientes',
              };
            }
          } catch (err) {
            this.logger.error(
              `Error buscando suscripciones pendientes: ${err.message}`,
            );
            return {
              success: false,
              message: `Error en activación manual: ${err.message}`,
            };
          }
        }

        return {
          success: false,
          message: 'No se proporcionó un tenant_id válido',
        };
      }

      // Flujo normal - Buscar si existe alguna suscripción pendiente
      const subscription =
        await this.subscriptionsService.getSubscriptionByTenantId(tenantId);

      if (subscription && subscription.status === 'pending') {
        // Obtener historial de pagos reciente
        const recentPayments =
          await this.subscriptionsService.getPaymentHistory(tenantId);

        // Si hay pagos recientes exitosos, actualizar la suscripción
        const successfulPayment = recentPayments.find(
          (p) => p.status === 'successful',
        );

        if (successfulPayment) {
          this.logger.log(
            `Encontrado pago exitoso para tenant ${tenantId}, activando suscripción`,
          );

          // Actualizar estado de suscripción a activo
          await this.subscriptionsService.handleSubscriptionUpdated(
            subscription.id, // Usamos el ID de la suscripción
            'ACTIVE', // Actualizamos a estado activo
          );

          return {
            success: true,
            message: 'Suscripción activada correctamente',
          };
        }

        // Si no hay pagos recientes, verificar con Wompi
        this.logger.log(
          `No se encontraron pagos locales, verificando con Wompi`,
        );

        // Comprobar estado de transacción con Wompi
        const latestTransactionStatus =
          await this.wompiService.checkLatestTransactionByReference(
            `sub_${subscription.id}`,
          );

        if (latestTransactionStatus === 'APPROVED') {
          this.logger.log(
            `Transacción verificada con Wompi como APPROVED, activando suscripción`,
          );

          // Registrar el pago y actualizar la suscripción
          await this.subscriptionsService.handleSubscriptionUpdated(
            subscription.id,
            'ACTIVE',
          );

          return {
            success: true,
            message: 'Suscripción verificada y activada correctamente',
          };
        }

        // En desarrollo, activar la suscripción automáticamente después de un tiempo
        if (this.configService.get<string>('NODE_ENV') !== 'production') {
          this.logger.log(
            `Ambiente de desarrollo: Activando suscripción pendiente automáticamente`,
          );

          // Registrar un pago simulado
          await this.subscriptionsService.recordPayment(
            tenantId,
            subscription.id,
            subscription.plan ? subscription.plan.price : 27000,
            'COP',
            'successful',
            `dev_${Date.now()}`,
            '',
          );

          // Actualizar la suscripción a activa
          await this.subscriptionsService.handleSubscriptionUpdated(
            subscription.id,
            'ACTIVE',
          );

          return {
            success: true,
            message:
              'Suscripción activada en modo desarrollo (después de verificación con Wompi)',
            subscription,
          };
        }
      }

      return {
        success: false,
        message: 'No se encontraron cambios en la suscripción',
      };
    } catch (error) {
      this.logger.error(
        `Error al refrescar estado de suscripción: ${error.message}`,
      );
      throw new Error(
        `Error al refrescar estado de suscripción: ${error.message}`,
      );
    }
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
