// src/subscriptions/guards/subscription-limits.guard.ts

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SubscriptionsService } from '../services/subscriptions.service';

@Injectable()
export class SubscriptionLimitsGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionLimitsGuard.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.tenant_id) {
      this.logger.warn('No user or tenant_id found in request');
      return false;
    }

    try {
      // Verificar si puede crear citas según su suscripción
      const { canCreateAppointment, message } =
        await this.subscriptionsService.checkSubscriptionStatus(user.tenant_id);

      if (!canCreateAppointment) {
        // Agregar mensaje al request para que pueda ser usado en la respuesta
        request.subscriptionLimitMessage = message;
        return false;
      }

      // Si puede crear la cita, actualizar contador si está en periodo de prueba
      if (canCreateAppointment) {
        await this.subscriptionsService.updateTrialAppointmentUsage(
          user.tenant_id,
        );
      }

      return true;
    } catch (error) {
      this.logger.error(`Error checking subscription limits: ${error.message}`);
      return false;
    }
  }
}
