import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm'; // Importar Between desde typeorm
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { PaymentHistory } from '../entities/payment-history.entity';
import { WompiService } from './wompi.service';
import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly planRepository: Repository<SubscriptionPlan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,

    @InjectRepository(PaymentHistory)
    private readonly paymentRepository: Repository<PaymentHistory>,

    private readonly wompiService: WompiService,

    private readonly configService: ConfigService,
  ) {}

  // Métodos para gestionar planes de suscripción
  async createPlan(
    createPlanDto: CreateSubscriptionPlanDto,
  ): Promise<SubscriptionPlan> {
    const plan = this.planRepository.create(createPlanDto);
    return await this.planRepository.save(plan);
  }

  async getAllPlans(): Promise<SubscriptionPlan[]> {
    return await this.planRepository.find({ where: { is_active: true } });
  }

  async getPlanById(id: string): Promise<SubscriptionPlan> {
    const plan = await this.planRepository.findOne({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`Plan with ID ${id} not found`);
    }
    return plan;
  }

  // Agregar a src/subscriptions/services/subscriptions.service.ts

  async getAllSubscriptions(): Promise<Subscription[]> {
    return await this.subscriptionRepository.find({
      relations: ['plan', 'payments'],
      order: {
        created_at: 'DESC',
      },
    });
  }

  async findSubscriptionById(id: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
      relations: ['plan', 'payments'],
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }

    return subscription;
  }

  async updatePlan(
    id: string,
    updatePlanDto: UpdateSubscriptionPlanDto,
  ): Promise<SubscriptionPlan> {
    const plan = await this.getPlanById(id);
    this.planRepository.merge(plan, updatePlanDto);
    return await this.planRepository.save(plan);
  }

  // Métodos para gestionar suscripciones
  async createTrialSubscription(tenantId: string): Promise<Subscription> {
    const subscription = this.subscriptionRepository.create({
      tenant_id: tenantId,
      status: 'trial',
      trial_appointments_used: 0,
      trial_appointments_limit: 20,
    });

    return await this.subscriptionRepository.save(subscription);
  }

  async getSubscriptionByTenantId(tenantId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { tenant_id: tenantId },
      relations: ['plan', 'payments'],
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription for tenant ${tenantId} not found`,
      );
    }

    return subscription;
  }

  async getSubscriptionByWompiId(
    wompiSubscriptionId: string,
  ): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { wompi_subscription_id: wompiSubscriptionId },
    });

    return subscription;
  }

  async updateTrialAppointmentUsage(tenantId: string): Promise<Subscription> {
    let subscription;

    try {
      subscription = await this.getSubscriptionByTenantId(tenantId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.log(
          `Creating trial subscription for tenant ${tenantId} during updateTrialAppointmentUsage`,
        );
        subscription = await this.createTrialSubscription(tenantId);
      } else {
        throw error;
      }
    }

    if (subscription.status !== 'trial') {
      return subscription; // No actualizar si no está en periodo de prueba
    }

    subscription.trial_appointments_used += 1;

    // Verificar si se alcanzó el límite de prueba
    if (
      subscription.trial_appointments_used >=
      subscription.trial_appointments_limit
    ) {
      subscription.is_trial_used = true;
    }

    return await this.subscriptionRepository.save(subscription);
  }

  // Método modificado createPaidSubscription
  async createPaidSubscription(
    createSubDto: CreateSubscriptionDto,
    userEmail: string,
    userName: string,
    userPhone: string,
  ): Promise<Subscription | any> {
    try {
      // Obtener la suscripción actual o crear una nueva
      let subscription;
      try {
        subscription = await this.getSubscriptionByTenantId(
          createSubDto.tenant_id,
        );
      } catch (error) {
        if (error instanceof NotFoundException) {
          this.logger.log(
            `Creating trial subscription for tenant ${createSubDto.tenant_id} during createPaidSubscription`,
          );
          subscription = await this.createTrialSubscription(
            createSubDto.tenant_id,
          );
        } else {
          throw error;
        }
      }

      // Obtener el plan
      const plan = await this.getPlanById(createSubDto.plan_id);

      // Generar una referencia única
      const reference = `sub_${subscription.id}`;
      const description = `Suscripción al plan ${plan.name}`;

      // Determinar la URL de callback basada en el ambiente
      const isProduction =
        this.configService.get<string>('NODE_ENV') === 'production';

      let redirectUrl;
      if (isProduction) {
        // URL para producción (debe ser HTTPS)
        // Intentar usar la URL proporcionada si es válida HTTPS
        if (
          createSubDto.redirect_url &&
          createSubDto.redirect_url.startsWith('https://')
        ) {
          redirectUrl = createSubDto.redirect_url;
        } else {
          // Usar la URL configurada o una por defecto
          redirectUrl =
            this.configService.get<string>('WOMPI_REDIRECT_URL') ||
            'https://tuapp.com/payment-callback';
        }
      } else {
        // URL para desarrollo - mantener esquema myapp:// para el flujo de demo
        redirectUrl = createSubDto.redirect_url || 'myapp://payment-callback';
      }

      // Actualizar la suscripción en nuestra base de datos
      subscription.status = 'pending';
      subscription.plan = plan;
      subscription.subscription_start_date = new Date();

      // Calcular fecha de fin basada en la duración del plan
      const endDate = new Date();
      if (plan.name.toLowerCase().includes('semestral')) {
        endDate.setMonth(endDate.getMonth() + 6);
      } else if (
        plan.name.toLowerCase().includes('anual') ||
        plan.billing_interval === 'year'
      ) {
        endDate.setMonth(endDate.getMonth() + 12);
      } else {
        // Plan mensual estándar
        endDate.setMonth(endDate.getMonth() + 1);
      }
      subscription.subscription_end_date = endDate;

      const savedSubscription =
        await this.subscriptionRepository.save(subscription);

      let paymentLink = '';

      // Crear un enlace de pago
      try {
        paymentLink = await this.wompiService.createPaymentLink(
          plan.price,
          description,
          redirectUrl,
          reference,
          plan.currency,
        );

        if (!paymentLink || paymentLink.trim() === '') {
          throw new Error('No se generó un enlace de pago válido');
        }

        // Agregar el link de pago a la respuesta
        return {
          ...savedSubscription,
          payment_link: paymentLink,
        };
      } catch (wompiError) {
        this.logger.error(`Error al crear link de pago: ${wompiError.message}`);

        // Solo con NODE_ENV=development: enlace de demostración.
        if (this.wompiService.devShortcutsEnabled) {
          this.logger.log('Generando enlace de demostración para pruebas...');

          // Usar un esquema que funcione en dispositivos móviles
          const testLink = `myapp://payment-demo?reference=${reference}&redirect=${encodeURIComponent(redirectUrl)}`;

          return {
            ...savedSubscription,
            payment_link: testLink,
            is_test: true,
          };
        }

        // Intentar crear un registro de error para monitoreo
        try {
          const paymentHistory = this.paymentRepository.create({
            tenant_id: createSubDto.tenant_id,
            subscription,
            amount: plan.price,
            currency: plan.currency,
            status: 'failed',
            wompi_transaction_id: 'error',
            wompi_transaction_url: '',
            payment_date: new Date(),
            metadata: {
              error: wompiError.message,
              timestamp: new Date().toISOString(),
            },
          });

          await this.paymentRepository.save(paymentHistory);
        } catch (historyError) {
          this.logger.error(
            `Error al registrar fallo: ${historyError.message}`,
          );
        }

        // En producción, propagar el error para manejarlo en el cliente
        throw new Error(`Error al crear enlace de pago: ${wompiError.message}`);
      }
    } catch (error) {
      this.logger.error(`Error creating paid subscription: ${error.message}`);

      // Solo con NODE_ENV=development: enlace de pago de respaldo.
      if (this.wompiService.devShortcutsEnabled) {
        // Generar un ID aleatorio si no tenemos uno
        const fallbackId = Math.random().toString(36).substring(2, 15);
        const reference = `sub_fallback_${fallbackId}`;
        const redirectUrl = 'myapp://payment-callback';

        this.logger.log(
          'Proporcionando enlace de respaldo después de error general',
        );
        return {
          id: fallbackId,
          tenant_id: 'fallback',
          status: 'pending',
          payment_link: `myapp://payment-demo?reference=${reference}&redirect=${encodeURIComponent(redirectUrl)}`,
          is_test: true,
          is_fallback: true,
        };
      }

      throw error;
    }
  }

  async checkSubscriptionStatus(tenantId: string): Promise<{
    canCreateAppointment: boolean;
    message?: string;
  }> {
    try {
      // Intentar obtener la suscripción
      let subscription;

      try {
        subscription = await this.getSubscriptionByTenantId(tenantId);
      } catch (error) {
        // Si no existe, crear una suscripción de prueba
        if (error instanceof NotFoundException) {
          this.logger.log(`Creating trial subscription for tenant ${tenantId}`);
          subscription = await this.createTrialSubscription(tenantId);
        } else {
          throw error; // Si es otro tipo de error, propagarlo
        }
      }

      // Si está en periodo de prueba y no ha alcanzado el límite
      if (
        subscription.status === 'trial' &&
        subscription.trial_appointments_used <
          subscription.trial_appointments_limit
      ) {
        return {
          canCreateAppointment: true,
          message: `Citas restantes en prueba: ${subscription.trial_appointments_limit - subscription.trial_appointments_used}`,
        };
      }

      // Si está en período de prueba pero ya alcanzó el límite
      if (
        subscription.status === 'trial' &&
        subscription.trial_appointments_used >=
          subscription.trial_appointments_limit
      ) {
        return {
          canCreateAppointment: false,
          message:
            'Has alcanzado el límite de citas de prueba. Por favor, adquiere un plan para continuar.',
        };
      }

      // Si tiene un plan activo
      if (subscription.status === 'active' && subscription.plan) {
        // Verificar si la suscripción ha expirado
        const now = new Date();
        if (
          subscription.subscription_end_date &&
          subscription.subscription_end_date < now
        ) {
          subscription.status = 'expired';
          await this.subscriptionRepository.save(subscription);

          return {
            canCreateAppointment: false,
            message: 'Tu suscripción ha expirado. Por favor, renueva tu plan.',
          };
        }

        // Si el plan tiene citas ilimitadas (como mencionaste que todos tus planes pagos tendrán)
        if (subscription.plan.appointment_limit === -1) {
          return {
            canCreateAppointment: true,
            message: 'Plan activo con citas ilimitadas',
          };
        }

        // En caso de que en el futuro implementes planes con límites
        const appointmentsCount = 0; // Esto debe implementarse si decides tener planes con límites

        if (appointmentsCount < subscription.plan.appointment_limit) {
          return {
            canCreateAppointment: true,
            message: `Citas restantes en tu plan: ${subscription.plan.appointment_limit - appointmentsCount}`,
          };
        } else {
          return {
            canCreateAppointment: false,
            message: 'Has alcanzado el límite de citas de tu plan actual.',
          };
        }
      }

      // En otros casos (cancelada, expirada, etc.)
      return {
        canCreateAppointment: false,
        message: 'Tu suscripción no está activa. Por favor, actualiza tu plan.',
      };
    } catch (error) {
      this.logger.error(`Error checking subscription status: ${error.message}`);
      // Por defecto, si hay un error, no permitir la creación
      return {
        canCreateAppointment: false,
        message: 'Error al verificar estado de suscripción.',
      };
    }
  }

  async getPaymentHistory(tenantId: string): Promise<PaymentHistory[]> {
    try {
      // Intentar obtener la suscripción primero
      let subscription;

      try {
        subscription = await this.getSubscriptionByTenantId(tenantId);
      } catch (error) {
        if (error instanceof NotFoundException) {
          // Si no existe suscripción, devolvemos array vacío de pagos
          return [];
        }
        throw error;
      }

      return await this.paymentRepository.find({
        where: { tenant_id: tenantId },
        order: { payment_date: 'DESC' },
      });
    } catch (error) {
      this.logger.error(`Error getting payment history: ${error.message}`);
      return [];
    }
  }

  async handleSubscriptionUpdated(
    subscriptionId: string,
    status: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Actualizando estado de suscripción: ${subscriptionId} a ${status}`,
      );

      // Buscar la suscripción por ID
      const subscription = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
      });

      if (subscription) {
        // Mapear el estado de Wompi a nuestro estado interno
        subscription.status = this.mapWompiStatus(status);

        // Si se activa la suscripción, asegurarse de establecer fechas adecuadas
        if (subscription.status === 'active') {
          const now = new Date();
          subscription.subscription_start_date = now;

          // Establecer fecha de fin basada en la duración del plan
          if (subscription.plan) {
            const endDate = new Date();
            if (subscription.plan.name.toLowerCase().includes('semestral')) {
              endDate.setMonth(endDate.getMonth() + 6);
            } else if (
              subscription.plan.name.toLowerCase().includes('anual') ||
              subscription.plan.billing_interval === 'year'
            ) {
              endDate.setMonth(endDate.getMonth() + 12);
            } else {
              // Plan mensual estándar
              endDate.setMonth(endDate.getMonth() + 1);
            }
            subscription.subscription_end_date = endDate;
          }
        }

        // Guardar la suscripción actualizada
        await this.subscriptionRepository.save(subscription);

        this.logger.log(
          `Suscripción ${subscription.id} actualizada a estado: ${subscription.status}`,
        );
      } else {
        this.logger.warn(
          `No se encontró suscripción con ID: ${subscriptionId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error actualizando estado de suscripción: ${error.message}`,
      );
      throw error;
    }
  }

  // Si no existe ya, también necesitas el método mapWompiStatus
  private mapWompiStatus(wompiStatus: string): string {
    // Mapear estados de Wompi a nuestros estados
    const statusMap = {
      ACTIVE: 'active',
      APPROVED: 'active',
      PENDING: 'past_due',
      CANCELED: 'canceled',
      REJECTED: 'past_due',
      FAILED: 'past_due',
      EXPIRED: 'expired',
      TRIAL: 'trial',
    };

    return statusMap[wompiStatus] || 'past_due';
  }

  async recordPayment(
    tenantId: string,
    subscriptionId: string,
    amount: number,
    currency: string,
    status: string,
    transactionId: string,
    transactionUrl: string,
  ): Promise<PaymentHistory> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    // Si el pago es exitoso, actualizar el estado de la suscripción
    if (status === 'successful' || status === 'APPROVED') {
      subscription.status = 'active';
      await this.subscriptionRepository.save(subscription);
    }

    const payment = this.paymentRepository.create({
      tenant_id: tenantId,
      subscription,
      amount,
      currency,
      status,
      wompi_transaction_id: transactionId,
      wompi_transaction_url: transactionUrl,
      payment_date: new Date(),
    });

    return await this.paymentRepository.save(payment);
  }

  async createPaymentLink(
    tenantId: string,
    planId: string,
    redirectUrl: string,
  ): Promise<string> {
    let subscription;

    try {
      subscription = await this.getSubscriptionByTenantId(tenantId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        subscription = await this.createTrialSubscription(tenantId);
      } else {
        throw error;
      }
    }

    const plan = await this.getPlanById(planId);

    const reference = `sub_${subscription.id}`;
    const description = `Suscripción al plan ${plan.name}`;

    return await this.wompiService.createPaymentLink(
      plan.price,
      description,
      redirectUrl,
      reference,
      plan.currency,
    );
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    try {
      this.logger.log(`Cancelando suscripción para tenant: ${tenantId}`);

      const subscription = await this.getSubscriptionByTenantId(tenantId);

      // Si la suscripción ya está cancelada, simplemente devuélvela
      if (subscription.status === 'canceled') {
        return subscription;
      }

      // Verificar si hay un ID de suscripción de Wompi para cancelar
      if (
        subscription.wompi_subscription_id &&
        subscription.wompi_subscription_id.startsWith('sub_')
      ) {
        try {
          // Intentar cancelar en Wompi, pero manejar fallos si ocurren
          await this.wompiService.cancelSubscription(
            subscription.wompi_subscription_id,
          );
        } catch (wompiError) {
          // Loguear el error, pero continuar con la cancelación local
          this.logger.error(
            `Error al cancelar suscripción en Wompi: ${wompiError.message}`,
          );
        }
      }

      // Cancelar la suscripción localmente
      subscription.status = 'canceled';

      // Guardar y devolver la suscripción actualizada
      return await this.subscriptionRepository.save(subscription);
    } catch (error) {
      this.logger.error(`Error al cancelar suscripción: ${error.message}`);
      throw error;
    }
  }

  // Nuevo método para renovar suscripciones (para uso futuro con notificaciones)
  async renewSubscription(
    tenantId: string,
    planId: string,
    redirectUrl: string,
  ): Promise<string> {
    // Este método genera un link de pago para renovar una suscripción existente
    return await this.createPaymentLink(tenantId, planId, redirectUrl);
  }

  // Método para enviar notificaciones de próxima expiración
  async sendExpirationReminders(): Promise<void> {
    try {
      // Buscar todas las suscripciones activas que expiran en los próximos 7 días
      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const expiringSubscriptions = await this.subscriptionRepository.find({
        where: {
          status: 'active',
          subscription_end_date: Between(now, nextWeek),
        },
        relations: ['plan'],
      });

      // Aquí implementarías la lógica para enviar correos o notificaciones
      for (const subscription of expiringSubscriptions) {
        this.logger.log(
          `Subscription ${subscription.id} for tenant ${subscription.tenant_id} expires soon`,
        );

        // Ejemplo: enviar correo de recordatorio
        // await this.emailService.sendExpirationReminder(subscription);
      }
    } catch (error) {
      this.logger.error(`Error sending expiration reminders: ${error.message}`);
    }
  }
}
