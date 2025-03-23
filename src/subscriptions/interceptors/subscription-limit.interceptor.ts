// src/subscriptions/interceptors/subscription-limit.interceptor.ts

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class SubscriptionLimitInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Si el guard añadió un mensaje de error por límite de suscripción
    if (request.subscriptionLimitMessage) {
      throw new ForbiddenException({
        message: request.subscriptionLimitMessage,
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        subscriptionRequired: true,
      });
    }

    return next.handle();
  }
}
