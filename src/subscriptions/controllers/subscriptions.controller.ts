import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  Logger,
} from '@nestjs/common';

import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { hasRoles } from '../../auth/jwt/has.roles';
import { JwtRoles } from '../../auth/jwt/jwt.role';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from '../services/subscriptions.service';
import { WompiService } from '../services/wompi.service';
import { AuthUser } from '../../auth/interfaces';

@Controller('subscriptions')
export class SubscriptionsController {
  private readonly logger = new Logger(SubscriptionsController.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly wompiService: WompiService,
  ) {}

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

  // Endpoints para suscripciones de tenants
  @Get('status')
  getSubscriptionStatus(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.getSubscriptionByTenantId(user.tenantId);
  }

  @Get('check-limits')
  checkSubscriptionLimits(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.checkSubscriptionStatus(user.tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Post('subscribe')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() createSubscriptionDto: CreateSubscriptionDto,
  ) {
    // Asegurar que el tenant_id en el DTO coincida con el del usuario
    createSubscriptionDto.tenant_id = user.tenantId;

    return this.subscriptionsService.createPaidSubscription(
      createSubscriptionDto,
      user.email,
      // El JWT no trae apellido ni teléfono (antes llegaban como undefined).
      user.name,
      undefined,
    );
  }

  @Post('refresh-status')
  @HttpCode(200)
  async refreshSubscriptionStatus(@CurrentUser() user: AuthUser) {
    try {
      // Obtener el tenant_id
      const tenantId = user?.tenantId;

      this.logger.log(
        `Refrescando estado de suscripción para tenant ${tenantId}`,
      );

      // Manejo especial para entorno de desarrollo cuando tenantId es undefined
      if (!tenantId) {
        this.logger.warn(
          'refreshSubscriptionStatus llamado sin tenant_id válido',
        );

        // En desarrollo, activar la suscripción aunque no haya tenant_id
        if (this.wompiService.devShortcutsEnabled) {
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
        if (this.wompiService.devShortcutsEnabled) {
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
  @Post('cancel')
  @HttpCode(200)
  cancelSubscription(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.cancelSubscription(user.tenantId);
  }

  @Get('payment-history')
  getPaymentHistory(@CurrentUser() user: AuthUser) {
    return this.subscriptionsService.getPaymentHistory(user.tenantId);
  }
}
