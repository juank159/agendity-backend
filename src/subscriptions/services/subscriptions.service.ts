import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import {
  Between,
  EntityManager,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { Subscription } from '../entities/subscription.entity';
import { PaymentHistory } from '../entities/payment-history.entity';
import { WompiService } from './wompi.service';
import { CreateSubscriptionPlanDto } from '../dto/create-subscription-plan.dto';
import { UpdateSubscriptionPlanDto } from '../dto/update-subscription-plan.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { ConfigService } from '@nestjs/config';
import { ErrorCode, LEGACY_STATUS } from 'src/common/constants/error-codes';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import {
  AppointmentAllowance,
  SUBSCRIPTION_MESSAGES,
  SubscriptionStatus,
  TRIAL_APPOINTMENTS_LIMIT,
  appointmentAllowance,
  effectiveStatus,
  paidPlanLimit,
  planPeriodEnd,
} from '../subscription-state';

/** Respuesta de `POST /subscriptions/refresh-status`. */
type RefreshResult = {
  success: boolean;
  message: string;
  subscription?: Subscription;
};

/** Vista de `GET /subscriptions/status`: la fila (o un trial sin usar) con el estado efectivo. */
export type SubscriptionStatusView = Omit<Subscription, 'id'> & {
  id: string | null;
};

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

  // Suscripción del negocio (tenant = id del Owner, 2.01). Una fila por negocio;
  // si hubiera varias, manda la más reciente (antes: "la primera fila").

  /** Crea el trial de un negocio nuevo. Solo lo llama el registro del Owner. */
  async createTrialSubscription(
    tenantId: string,
    manager: EntityManager = this.subscriptionRepository.manager,
  ): Promise<Subscription> {
    const subscription = manager.create(Subscription, {
      tenant_id: this.requireTenant(tenantId),
      status: SubscriptionStatus.TRIAL,
      trial_appointments_used: 0,
      trial_appointments_limit: TRIAL_APPOINTMENTS_LIMIT,
    });
    return await manager.save(subscription);
  }

  /** TypeORM ignora `where: { tenant_id: undefined }` y devolvería la fila de otro negocio. */
  private requireTenant(tenantId: string): string {
    if (!tenantId) {
      throw new NotFoundException('Suscripción no encontrada');
    }
    return tenantId;
  }

  /** Suscripción del negocio o `null`. Solo lectura. */
  private async findTenantSubscription(
    tenantId: string,
    withPayments = false,
  ): Promise<Subscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { tenant_id: this.requireTenant(tenantId) },
      relations: withPayments ? { plan: true, payments: true } : { plan: true },
      order: { created_at: 'DESC' },
    });
  }

  async getSubscriptionByTenantId(tenantId: string): Promise<Subscription> {
    const subscription = await this.findTenantSubscription(tenantId, true);

    if (!subscription) {
      throw new NotFoundException(
        `Subscription for tenant ${tenantId} not found`,
      );
    }

    return subscription;
  }

  /**
   * `GET /subscriptions/status`. No escribe: sin fila responde un trial sin usar
   * (no lo crea) y una suscripción vencida sale como `expired` aunque la fila
   * siga en `active` (la actualiza el cron `expireOverdueSubscriptions`).
   */
  async getSubscriptionStatus(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<SubscriptionStatusView> {
    const subscription = await this.findTenantSubscription(tenantId, true);
    if (!subscription) {
      return {
        id: null,
        tenant_id: tenantId,
        status: SubscriptionStatus.TRIAL,
        wompi_customer_id: null,
        wompi_subscription_id: null,
        plan: null,
        trial_appointments_used: 0,
        trial_appointments_limit: TRIAL_APPOINTMENTS_LIMIT,
        subscription_start_date: null,
        subscription_end_date: null,
        is_trial_used: false,
        payments: [],
        created_at: null,
        updated_at: null,
      };
    }
    return { ...subscription, status: effectiveStatus(subscription, now) };
  }

  /** Citas creadas por el negocio desde el inicio del periodo pagado. */
  private async countAppointmentsInPeriod(
    manager: EntityManager,
    tenantId: string,
    subscription: Subscription,
  ): Promise<number> {
    return await manager.count(Appointment, {
      where: {
        ownerId: tenantId,
        ...(subscription.subscription_start_date
          ? {
              created_at: MoreThanOrEqual(subscription.subscription_start_date),
            }
          : {}),
      },
    });
  }

  /**
   * Consume una cita del cupo del negocio. Debe llamarse DENTRO de la
   * transacción que crea la cita: si la creación falla, el rollback devuelve
   * la cita al cupo. Si no se puede crear, lanza `TRIAL_LIMIT_REACHED` o
   * `SUBSCRIPTION_INACTIVE` (HTTP legado 400, D-11).
   *
   * Concurrencia: un advisory lock por negocio serializa los consumos (también
   * cuando aún no hay fila y hay que crearla) y la fila se bloquea con
   * `FOR UPDATE` frente a otras escrituras (webhook, cancelar). El UPDATE del
   * trial además es condicional: nunca pasa de `trial_appointments_limit`.
   */
  async consumeAppointmentQuota(
    tenantId: string,
    manager: EntityManager,
    now: Date = new Date(),
  ): Promise<AppointmentAllowance> {
    this.requireTenant(tenantId);
    if (!manager.queryRunner?.isTransactionActive) {
      throw new Error(
        'consumeAppointmentQuota debe ejecutarse dentro de una transacción',
      );
    }

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`subscription:${tenantId}`],
    );

    let subscription = await manager
      .getRepository(Subscription)
      .createQueryBuilder('subscription')
      .leftJoinAndSelect('subscription.plan', 'plan')
      .where('subscription.tenant_id = :tenantId', { tenantId })
      .orderBy('subscription.created_at', 'DESC')
      .setLock('pessimistic_write', undefined, ['subscription'])
      .getOne();

    if (!subscription) {
      // Negocio sin fila (registrado antes de que existiera el trial): se crea aquí,
      // dentro de la transacción de la cita.
      subscription = await this.createTrialSubscription(tenantId, manager);
    }

    const appointmentsInPeriod =
      paidPlanLimit(subscription, now) === null
        ? 0
        : await this.countAppointmentsInPeriod(manager, tenantId, subscription);
    const allowance = appointmentAllowance(
      subscription,
      now,
      appointmentsInPeriod,
    );

    if (!allowance.canCreateAppointment) {
      this.throwNotAllowed(allowance);
    }

    if (subscription.status === SubscriptionStatus.TRIAL) {
      const result = await manager
        .createQueryBuilder()
        .update(Subscription)
        .set({
          trial_appointments_used: () => 'trial_appointments_used + 1',
          is_trial_used: () =>
            'trial_appointments_used + 1 >= trial_appointments_limit',
        })
        .where('id = :id', { id: subscription.id })
        .andWhere('status = :trial', { trial: SubscriptionStatus.TRIAL })
        .andWhere('trial_appointments_used < trial_appointments_limit')
        .execute();

      if (!result.affected) {
        this.throwNotAllowed({
          canCreateAppointment: false,
          code: ErrorCode.TRIAL_LIMIT_REACHED,
          message: SUBSCRIPTION_MESSAGES.trialLimitReached,
        });
      }
    }

    return allowance;
  }

  private throwNotAllowed(allowance: AppointmentAllowance): never {
    const code = allowance.code ?? ErrorCode.SUBSCRIPTION_INACTIVE;
    throw new BusinessException(
      code,
      allowance.message || SUBSCRIPTION_MESSAGES.inactive,
      LEGACY_STATUS[code],
    );
  }

  /**
   * Persiste el vencimiento: `active` con la fecha de fin pasada → `expired`.
   * Las lecturas ya lo calculan al vuelo (`effectiveStatus`); esto solo deja la
   * fila coherente para consultas por `status`. Idempotente.
   */
  @Cron('0 3 * * *')
  async expireOverdueSubscriptions(now: Date = new Date()): Promise<number> {
    const result = await this.subscriptionRepository.update(
      {
        status: SubscriptionStatus.ACTIVE,
        subscription_end_date: LessThan(now),
      },
      { status: SubscriptionStatus.EXPIRED },
    );
    if (result.affected) {
      this.logger.log(`Suscripciones vencidas marcadas: ${result.affected}`);
    }
    return result.affected ?? 0;
  }

  /**
   * Pide un enlace de pago para el plan y deja la suscripción del negocio en
   * `pending`. `tenantId` sale de `@Tenant()`; el `tenant_id` del DTO se ignora.
   */
  async createPaidSubscription(
    tenantId: string,
    createSubDto: CreateSubscriptionDto,
  ): Promise<Subscription | any> {
    try {
      // Es una escritura: si el negocio aún no tiene fila, se crea aquí.
      const subscription =
        (await this.findTenantSubscription(tenantId)) ??
        (await this.createTrialSubscription(tenantId));

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

      // Fin del periodo según `plan.duration_months` (se recalcula al activarse).
      subscription.subscription_end_date = planPeriodEnd(
        subscription.subscription_start_date,
        plan,
      );

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
            tenant_id: tenantId,
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

  /**
   * `GET /subscriptions/check-limits`: ¿puede el negocio crear una cita? Solo
   * lectura (no crea el trial ni marca `expired`). La creación de la cita no usa
   * esta lectura: consume el cupo con `consumeAppointmentQuota`.
   */
  async checkSubscriptionStatus(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<AppointmentAllowance> {
    this.requireTenant(tenantId);
    try {
      const subscription = await this.findTenantSubscription(tenantId);
      const appointmentsInPeriod =
        paidPlanLimit(subscription, now) === null
          ? 0
          : await this.countAppointmentsInPeriod(
              this.subscriptionRepository.manager,
              tenantId,
              subscription,
            );
      return appointmentAllowance(subscription, now, appointmentsInPeriod);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error checking subscription status: ${error.message}`);
      // Por defecto, si hay un error, no permitir la creación
      return {
        canCreateAppointment: false,
        message: SUBSCRIPTION_MESSAGES.checkFailed,
      };
    }
  }

  /** Pagos de suscripción del negocio, del más reciente al más antiguo. */
  async getPaymentHistory(tenantId: string): Promise<PaymentHistory[]> {
    return await this.paymentRepository.find({
      where: { tenant_id: this.requireTenant(tenantId) },
      order: { payment_date: 'DESC' },
    });
  }

  async handleSubscriptionUpdated(
    subscriptionId: string,
    status: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Actualizando estado de suscripción: ${subscriptionId} a ${status}`,
      );

      // Buscar la suscripción por ID (con el plan: de él sale la duración)
      const subscription = await this.subscriptionRepository.findOne({
        where: { id: subscriptionId },
        relations: { plan: true },
      });

      if (subscription) {
        // Mapear el estado de Wompi a nuestro estado interno
        subscription.status = this.mapWompiStatus(status);

        // Si se activa la suscripción, asegurarse de establecer fechas adecuadas
        if (subscription.status === 'active') {
          const now = new Date();
          subscription.subscription_start_date = now;

          // Fin del periodo según `plan.duration_months`
          if (subscription.plan) {
            subscription.subscription_end_date = planPeriodEnd(
              now,
              subscription.plan,
            );
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

  /**
   * `POST /subscriptions/refresh-status`: si la suscripción del negocio está en
   * `pending`, la activa cuando hay un pago confirmado de ESTA suscripción en
   * este intento (posterior a `subscription_start_date`) o Wompi da la
   * transacción por aprobada. Solo el propio negocio (antes, en desarrollo y sin
   * tenant, activaba la última `pending` de cualquier negocio).
   */
  async refreshPendingSubscription(tenantId: string): Promise<RefreshResult> {
    const subscription = await this.findTenantSubscription(tenantId);

    if (subscription?.status === SubscriptionStatus.PENDING) {
      const since = subscription.subscription_start_date
        ? new Date(subscription.subscription_start_date).getTime()
        : 0;
      const payments = await this.paymentRepository.find({
        where: {
          tenant_id: tenantId,
          subscription: { id: subscription.id },
          status: 'successful',
        },
        order: { payment_date: 'DESC' },
      });
      const successfulPayment = payments.find(
        (p) => p.payment_date && new Date(p.payment_date).getTime() >= since,
      );

      if (successfulPayment) {
        this.logger.log(
          `Encontrado pago exitoso para tenant ${tenantId}, activando suscripción`,
        );
        await this.handleSubscriptionUpdated(subscription.id, 'ACTIVE');
        return { success: true, message: 'Suscripción activada correctamente' };
      }

      this.logger.log('No se encontraron pagos locales, verificando con Wompi');
      const latestTransactionStatus =
        await this.wompiService.checkLatestTransactionByReference(
          `sub_${subscription.id}`,
        );

      if (latestTransactionStatus === 'APPROVED') {
        this.logger.log(
          'Transacción verificada con Wompi como APPROVED, activando suscripción',
        );
        await this.handleSubscriptionUpdated(subscription.id, 'ACTIVE');
        return {
          success: true,
          message: 'Suscripción verificada y activada correctamente',
        };
      }

      // Solo con NODE_ENV=development: activar sin pago real.
      if (this.wompiService.devShortcutsEnabled) {
        this.logger.log(
          'Ambiente de desarrollo: Activando suscripción pendiente automáticamente',
        );
        await this.recordPayment(
          tenantId,
          subscription.id,
          subscription.plan ? subscription.plan.price : 27000,
          'COP',
          'successful',
          `dev_${Date.now()}`,
          '',
        );
        await this.handleSubscriptionUpdated(subscription.id, 'ACTIVE');
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
