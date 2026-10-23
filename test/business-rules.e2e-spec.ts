/**
 * Tarea 2.15: reglas decididas por el usuario que tocan suscripciones y
 * empleados. Escribe de verdad: SOLO contra una copia temporal de la BD
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`). En la corrida normal se omite.
 * Las reglas de citas (a, f, g) están en `appointment-status.e2e-spec.ts`.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Subscription } from '../src/subscriptions/entities/subscription.entity';
import { PaymentHistory } from '../src/subscriptions/entities/payment-history.entity';
import { SubscriptionPlan } from '../src/subscriptions/entities/subscription-plan.entity';
import { SubscriptionsService } from '../src/subscriptions/services/subscriptions.service';
import { WompiService } from '../src/subscriptions/services/wompi.service';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable(
  `Reglas del usuario 2.15 contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User | null;
    let ownerToken: string;
    let plan: SubscriptionPlan;

    const subscriptionRow = () =>
      ds.getRepository(Subscription).findOneOrFail({
        where: { tenant_id: owner.id },
        relations: { plan: true },
        order: { created_at: 'DESC' },
      });

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      // Nunca llamar a Wompi de verdad.
      jest
        .spyOn(WompiService.prototype, 'createPaymentLink')
        .mockResolvedValue('https://checkout.test/link');
      jest
        .spyOn(WompiService.prototype, 'checkLatestTransactionByReference')
        .mockResolvedValue('PENDING');
      ({ owner, employee } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
      plan = await ds
        .getRepository(SubscriptionPlan)
        .findOneOrFail({ where: { duration_months: 6 } });
      // Punto de partida conocido: trial con cupo y sin intentos de pago.
      const sub = await subscriptionRow();
      await ds.getRepository(PaymentHistory).delete({
        subscription: { id: sub.id },
      });
      await resetTrialQuota(ds, owner.id, { used: 5 });
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('(b) subscribe crea un intento pending y el negocio sigue en trial y puede agendar', async () => {
      const res = await http
        .post('/api/subscriptions/subscribe')
        .set(auth(ownerToken))
        .send({ plan_id: plan.id, tenant_id: owner.id });
      expect(res.status).toBe(201);
      expect(res.body.payment_link).toBe('https://checkout.test/link');
      expect(res.body.status).toBe('trial');

      const sub = await subscriptionRow();
      expect(sub.status).toBe('trial');
      expect(sub.plan).toBeNull();

      const status = await http
        .get('/api/subscriptions/status')
        .set(auth(ownerToken));
      expect(status.body.status).toBe('trial');
      expect(status.body.pending_payment).toMatchObject({
        plan_id: plan.id,
        amount: Number(plan.price),
      });
      const limits = await http
        .get('/api/subscriptions/check-limits')
        .set(auth(ownerToken));
      expect(limits.body.canCreateAppointment).toBe(true);

      // Wompi aún no confirma: refresh-status no cambia nada.
      const refresh = await http
        .post('/api/subscriptions/refresh-status')
        .set(auth(ownerToken));
      expect(refresh.body.success).toBe(false);
      expect((await subscriptionRow()).status).toBe('trial');
    });

    it('(b) pago rechazado: el intento queda failed y el negocio sigue en trial', async () => {
      const service = app.get(SubscriptionsService);
      const sub = await subscriptionRow();
      await service.handleSubscriptionUpdated(sub.id, 'FAILED');
      expect((await subscriptionRow()).status).toBe('trial');
      const attempts = await ds
        .getRepository(PaymentHistory)
        .find({ where: { subscription: { id: sub.id } } });
      expect(attempts.map((a) => a.status)).toEqual(['failed']);
    });

    it('(b) pago aprobado (webhook): completa el intento y activa el plan pedido', async () => {
      const service = app.get(SubscriptionsService);
      await http
        .post('/api/subscriptions/subscribe')
        .set(auth(ownerToken))
        .send({ plan_id: plan.id });
      const sub = await subscriptionRow();
      await service.recordPayment(
        owner.id,
        sub.id,
        Number(plan.price),
        'COP',
        'successful',
        'tx-e2e-1',
        '',
      );
      await service.handleSubscriptionUpdated(sub.id, 'ACTIVE');
      const active = await subscriptionRow();
      expect(active.status).toBe('active');
      expect(active.plan.id).toBe(plan.id);
      const attempts = await ds.getRepository(PaymentHistory).find({
        where: { subscription: { id: sub.id } },
        order: { created_at: 'ASC' },
      });
      expect(attempts.map((a) => a.status)).toEqual(['failed', 'successful']);
      expect(attempts[1].wompi_transaction_id).toBe('tx-e2e-1');
    });

    it('(c) cancelar un plan pagado: sigue vigente hasta la fecha de fin', async () => {
      const res = await http
        .post('/api/subscriptions/cancel')
        .set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'active',
        cancel_at_period_end: true,
      });
      expect((await subscriptionRow()).status).toBe('canceled');
      const status = await http
        .get('/api/subscriptions/status')
        .set(auth(ownerToken));
      expect(status.body).toMatchObject({
        status: 'active',
        cancel_at_period_end: true,
      });
      const limits = await http
        .get('/api/subscriptions/check-limits')
        .set(auth(ownerToken));
      expect(limits.body.canCreateAppointment).toBe(true);

      // Pasada la fecha de fin: canceled y sin agendar.
      const sub = await subscriptionRow();
      await ds.getRepository(Subscription).update(sub.id, {
        subscription_end_date: new Date(Date.now() - 60_000),
      });
      const after = await http
        .get('/api/subscriptions/check-limits')
        .set(auth(ownerToken));
      expect(after.body).toMatchObject({
        canCreateAppointment: false,
        code: 'SUBSCRIPTION_INACTIVE',
      });
    });

    it('(e) toggle-status no activa un empleado sin email verificado; restore lo deja inactivo', async () => {
      if (!employee) return;
      const users = ds.getRepository(User);
      const original = await users.findOneByOrFail({ id: employee.id });
      try {
        await users.update(employee.id, {
          is_email_verified: false,
          isActive: false,
        });
        const res = await http
          .patch(`/api/auth/employee/${employee.id}/status`)
          .set(auth(ownerToken))
          .send({ isActive: true });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
        expect(
          (await users.findOneByOrFail({ id: employee.id })).isActive,
        ).toBe(false);

        await users.softDelete(employee.id);
        const restored = await http
          .patch(`/api/auth/employee/${employee.id}/restore`)
          .set(auth(ownerToken));
        expect(restored.status).toBe(200);
        expect(restored.body.isActive).toBe(false);

        await users.update(employee.id, { is_email_verified: true });
        const ok = await http
          .patch(`/api/auth/employee/${employee.id}/status`)
          .set(auth(ownerToken))
          .send({ isActive: true });
        expect(ok.status).toBe(200);
      } finally {
        await users.restore(employee.id);
        await users.update(employee.id, {
          is_email_verified: original.is_email_verified,
          isActive: original.isActive,
        });
      }
    });
  },
);
