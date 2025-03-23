// src/subscriptions/services/subscriptions.service.ts

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { PaymentHistory } from '../entities/payment-history.entity';
import { WompiService } from './wompi.service';
import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';

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
    const subscription = await this.getSubscriptionByTenantId(tenantId);

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

  async createPaidSubscription(
    createSubDto: CreateSubscriptionDto,
    userEmail: string,
    userName: string,
    userPhone: string,
  ): Promise<Subscription> {
    try {
      // Obtener la suscripción actual
      let subscription = await this.getSubscriptionByTenantId(
        createSubDto.tenant_id,
      );

      // Obtener el plan
      const plan = await this.getPlanById(createSubDto.plan_id);

      // Crear cliente en Wompi si no existe
      if (!subscription.wompi_customer_id) {
        subscription.wompi_customer_id = await this.wompiService.createCustomer(
          userEmail,
          userName,
          userPhone,
        );
        subscription = await this.subscriptionRepository.save(subscription);
      }

      // Crear suscripción en Wompi
      const wompiSubscription = await this.wompiService.createSubscription(
        subscription.wompi_customer_id,
        plan.wompi_price_id,
        createSubDto.card_token_id,
        plan.price,
        plan.currency,
      );

      // Actualizar la suscripción en nuestra base de datos
      subscription.wompi_subscription_id = wompiSubscription.id;
      subscription.status =
        wompiSubscription.status === 'ACTIVE' ? 'active' : 'past_due';
      subscription.plan = plan;
      subscription.subscription_start_date = new Date();

      // Calcular fecha de fin basada en el intervalo de facturación
      const endDate = new Date();
      if (plan.billing_interval === 'month') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else if (plan.billing_interval === 'year') {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }
      subscription.subscription_end_date = endDate;

      return await this.subscriptionRepository.save(subscription);
    } catch (error) {
      this.logger.error(`Error creating paid subscription: ${error.message}`);
      throw error;
    }
  }

  async cancelSubscription(tenantId: string): Promise<Subscription> {
    const subscription = await this.getSubscriptionByTenantId(tenantId);

    if (subscription.wompi_subscription_id) {
      await this.wompiService.cancelSubscription(
        subscription.wompi_subscription_id,
      );
    }

    subscription.status = 'canceled';
    return await this.subscriptionRepository.save(subscription);
  }

  async checkSubscriptionStatus(tenantId: string): Promise<{
    canCreateAppointment: boolean;
    message?: string;
  }> {
    try {
      const subscription = await this.getSubscriptionByTenantId(tenantId);

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

      // Si está activa y tiene un plan
      if (subscription.status === 'active' && subscription.plan) {
        // Si el plan tiene citas ilimitadas
        if (subscription.plan.appointment_limit === -1) {
          return { canCreateAppointment: true };
        }

        // Contar citas creadas en el período actual
        // Aquí necesitarías implementar la lógica para contar citas
        // según el período de facturación actual
        const appointmentsCount = 0; // Esto debe implementarse

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
    const subscription = await this.getSubscriptionByTenantId(tenantId);

    return await this.paymentRepository.find({
      where: { tenant_id: tenantId },
      order: { payment_date: 'DESC' },
    });
  }

  // Métodos para el manejo de webhooks de Wompi
  async handleSubscriptionUpdated(
    wompiSubscriptionId: string,
    status: string,
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { wompi_subscription_id: wompiSubscriptionId },
    });

    if (subscription) {
      subscription.status = this.mapWompiStatus(status);
      await this.subscriptionRepository.save(subscription);
    }
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
    const subscription = await this.getSubscriptionByTenantId(tenantId);
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

  private mapWompiStatus(wompiStatus: string): string {
    // Mapear estados de Wompi a nuestros estados
    const statusMap = {
      ACTIVE: 'active',
      PENDING: 'past_due',
      CANCELED: 'canceled',
      REJECTED: 'past_due',
      FAILED: 'past_due',
      EXPIRED: 'expired',
      TRIAL: 'trial',
    };

    return statusMap[wompiStatus] || 'past_due';
  }
}
