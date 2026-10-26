/**
 * Tarea 2.06: máquina de estados de la cita, cancelar/completar y pagos.
 *
 * 1. Siempre (BD de desarrollo, sin escrituras): validación de los DTO nuevos y
 *    rutas de un Employee. Toda escritura de TypeORM está bloqueada con espías.
 * 2. Solo contra una COPIA temporal (escribe de verdad): flujo completo y
 *    carreras. Se activa con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`; nunca
 *    con `ecommerce` (se comprueba `current_database()` antes de escribir).
 *    Ejemplo: `E2E_WRITABLE_DB=agendity_tmp_206 DB_NAME=agendity_tmp_206 npm run test:e2e -- appointment-status`
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { Payment } from '../src/payments/entities/payment.entity';
import { Appointment } from '../src/appointments/entities/appointment.entity';
import { PaymentsService } from '../src/payments/payments.service';
import { AppointmentsService } from '../src/appointments/appointments.service';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
  firstFreeWeek,
  futureMonday,
} from './utils/writable-db';

const MISSING_ID = '33333333-3333-4333-8333-333333333333';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Estados de cita y pagos: validación y permisos (e2e, sin escrituras)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ownerToken: string;
  let employeeToken: string | null;
  let writeSpies: jest.SpyInstance[];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    const { owner, employee } = await findDevOwnerAndEmployee(
      app.get(DataSource),
    );
    ownerToken = signToken(owner, ['Owner']);
    employeeToken = employee ? signToken(employee, ['Employee']) : null;
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => {
    const block = () => {
      throw new Error('Escritura bloqueada en el test');
    };
    writeSpies = [
      ...['save', 'insert', 'update', 'remove', 'delete'].map((m) =>
        jest.spyOn(Repository.prototype as any, m).mockImplementation(block),
      ),
      ...['save', 'insert', 'update', 'remove', 'delete'].map((m) =>
        jest.spyOn(EntityManager.prototype as any, m).mockImplementation(block),
      ),
    ];
  });

  afterEach(() => {
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  afterAll(async () => close?.());

  it('el PATCH genérico ya no acepta payment_status y exige estados en MAYÚSCULAS', async () => {
    const t = auth(ownerToken);
    const paymentStatus = await http
      .patch(`/api/appointments/${MISSING_ID}`)
      .set(t)
      .send({ payment_status: 'COMPLETED' });
    expect(paymentStatus.status).toBe(400);
    expect(paymentStatus.body.code).toBe('VALIDATION_ERROR');

    const lower = await http
      .patch(`/api/appointments/${MISSING_ID}`)
      .set(t)
      .send({ status: 'cancelled' });
    expect(lower.status).toBe(400);
    expect(lower.body.code).toBe('VALIDATION_ERROR');
  });

  it('cancel/complete: id inexistente → 404; motivo demasiado largo → 400', async () => {
    const t = auth(ownerToken);
    const cancel = await http
      .patch(`/api/appointments/${MISSING_ID}/cancel`)
      .set(t)
      .send({});
    expect(cancel.status).toBe(404);
    const complete = await http
      .patch(`/api/appointments/${MISSING_ID}/complete`)
      .set(t);
    expect(complete.status).toBe(404);
    const long = await http
      .patch(`/api/appointments/${MISSING_ID}/cancel`)
      .set(t)
      .send({ cancellation_reason: 'x'.repeat(501) });
    expect(long.status).toBe(400);
  });

  it('el Employee puede llamar a cancel/complete (404 si no es suya) pero no al PATCH genérico (403)', async () => {
    if (!employeeToken) return;
    const t = auth(employeeToken);
    const cancel = await http
      .patch(`/api/appointments/${MISSING_ID}/cancel`)
      .set(t)
      .send({});
    expect(cancel.status).toBe(404);
    const complete = await http
      .patch(`/api/appointments/${MISSING_ID}/complete`)
      .set(t);
    expect(complete.status).toBe(404);
    const patch = await http
      .patch(`/api/appointments/${MISSING_ID}`)
      .set(t)
      .send({ status: 'CANCELLED' });
    expect(patch.status).toBe(403);
  });

  it('pagos: monto 0 o negativo, reembolso 0 → 400 de validación', async () => {
    const t = auth(ownerToken);
    for (const amount of [0, -10]) {
      const res = await http.post('/api/payments').set(t).send({
        appointment_id: MISSING_ID,
        amount,
        payment_method: 'CASH',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    const refund = await http
      .post(`/api/payments/${MISSING_ID}/refund`)
      .set(t)
      .send({ refund_amount: 0, refund_reason: 'x' });
    expect(refund.status).toBe(400);
  });
});

describeWritable(
  `Estados de cita y pagos contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User | null;
    let ownerToken: string;
    let employeeToken: string | null;
    let client: Client;
    let service: Service;
    let day = 0;

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      // Nada de recordatorios reales (el evento programa envíos).
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      ({ owner, employee } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
      employeeToken =
        employee && employee.isActive
          ? signToken(employee, ['Employee'])
          : null;
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      service = await ds.getRepository(Service).findOneOrFail({
        where: { ownerId: owner.id },
      });
      // Precondiciones propias (no dependen de otros specs ni del orden):
      // cupo de trial de sobra y fechas después de todas las citas ya creadas
      // en la copia (cada corrida crea las suyas, sin cruzarse con las previas).
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      day = await firstFreeWeek(ds);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => close?.());

    /** Cita a FUTURO (2.21), cada una en una semana distinta. */
    async function newAppointment(
      token = ownerToken,
      professionalId = owner.id,
    ): Promise<{ id: string; total: number }> {
      day += 1;
      // Lunes de una semana libre a las 10:00 Bogotá (horario L-V 9-18).
      const date = new Date(futureMonday(day) + 15 * 3_600_000);
      const res = await http
        .post('/api/appointments')
        .set(auth(token))
        .send({
          client_id: client.id,
          professional_id: professionalId,
          service_ids: [service.id],
          date: date.toISOString(),
        });
      expect(res.status).toBe(201);
      return { id: res.body.id, total: Number(res.body.total_price) };
    }

    const pay = (appointmentId: string, amount: number) =>
      http.post('/api/payments').set(auth(ownerToken)).send({
        appointment_id: appointmentId,
        amount,
        payment_method: 'CASH',
      });

    const statusOf = async (id: string) =>
      ds
        .getRepository(Appointment)
        .findOneByOrFail({ id })
        .then((a) => [a.status, a.payment_status]);

    it('pagar → CONFIRMED, completar → COMPLETED; COMPLETED es final', async () => {
      const { id, total } = await newAppointment();
      expect(await statusOf(id)).toEqual(['PENDING', 'PENDING']);

      expect((await pay(id, total + 1)).status).toBe(400); // supera el total
      expect((await pay(id, total)).status).toBe(201);
      expect(await statusOf(id)).toEqual(['CONFIRMED', 'COMPLETED']);
      const duplicate = await pay(id, total);
      expect([
        duplicate.status,
        duplicate.body.code,
        duplicate.body.message,
      ]).toEqual([
        409,
        'PAYMENT_ALREADY_EXISTS',
        'Ya existe un pago completado para esta cita',
      ]);

      const done = await http
        .patch(`/api/appointments/${id}/complete`)
        .set(auth(ownerToken));
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('COMPLETED');

      const again = await http
        .patch(`/api/appointments/${id}/complete`)
        .set(auth(ownerToken));
      expect(again.status).toBe(200); // mismo estado: no-op

      const cancel = await http
        .patch(`/api/appointments/${id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      expect(cancel.status).toBe(409);
      expect(cancel.body.code).toBe('INVALID_STATE_TRANSITION');
      const back = await http
        .patch(`/api/appointments/${id}`)
        .set(auth(ownerToken))
        .send({ status: 'PENDING' });
      expect(back.status).toBe(409);
      expect(await statusOf(id)).toEqual(['COMPLETED', 'COMPLETED']);
    });

    it('cancelar guarda el motivo, libera el hueco y bloquea pagos', async () => {
      const { id, total } = await newAppointment();
      const appointment = await ds
        .getRepository(Appointment)
        .findOneByOrFail({ id });
      const res = await http
        .patch(`/api/appointments/${id}/cancel`)
        .set(auth(ownerToken))
        .send({ cancellation_reason: 'No puede venir' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'CANCELLED',
        cancellation_reason: 'No puede venir',
      });
      const payment = await pay(id, total);
      expect(payment.status).toBe(409);
      expect(payment.body.code).toBe('INVALID_STATE_TRANSITION');
      const reopen = await http
        .patch(`/api/appointments/${id}`)
        .set(auth(ownerToken))
        .send({ status: 'CONFIRMED' });
      expect(reopen.status).toBe(409);

      // El hueco quedó libre: otra cita a la misma hora.
      const same = await http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: owner.id,
          service_ids: [service.id],
          date: appointment.date.toISOString(),
        });
      expect(same.status).toBe(201);
    });

    it('reembolso parcial, luego total; después admite un pago nuevo', async () => {
      const { id, total } = await newAppointment();
      const paid = await pay(id, total);
      const paymentId = paid.body.id;
      const part = Math.round(total * 30) / 100; // 30 %

      const first = await http
        .post(`/api/payments/${paymentId}/refund`)
        .set(auth(ownerToken))
        .send({ refund_amount: part, refund_reason: 'parcial' });
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('COMPLETED');
      expect(Number(first.body.refund_amount)).toBe(part);
      expect(await statusOf(id)).toEqual(['CONFIRMED', 'COMPLETED']);

      const tooMuch = await http
        .post(`/api/payments/${paymentId}/refund`)
        .set(auth(ownerToken))
        .send({ refund_amount: total, refund_reason: 'excede' });
      expect(tooMuch.status).toBe(400);

      const rest = await http
        .post(`/api/payments/${paymentId}/refund`)
        .set(auth(ownerToken))
        .send({
          refund_amount: Math.round((total - part) * 100) / 100,
          refund_reason: 'resto',
        });
      expect(rest.status).toBe(201);
      expect(rest.body.status).toBe('REFUNDED');
      expect(Number(rest.body.refund_amount)).toBe(total);
      expect(await statusOf(id)).toEqual(['CONFIRMED', 'REFUNDED']);

      expect((await pay(id, total)).status).toBe(201);
      expect(await statusOf(id)).toEqual(['CONFIRMED', 'COMPLETED']);
    });

    it('Employee: cancela sus citas, no las de otro profesional (404)', async () => {
      if (!employeeToken) return;
      const others = await newAppointment();
      const denied = await http
        .patch(`/api/appointments/${others.id}/cancel`)
        .set(auth(employeeToken))
        .send({});
      expect(denied.status).toBe(404);
      expect((await statusOf(others.id))[0]).toBe('PENDING');

      const own = await newAppointment(employeeToken, employee.id);
      const ok = await http
        .patch(`/api/appointments/${own.id}/cancel`)
        .set(auth(employeeToken))
        .send({ cancellation_reason: 'empleado' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('CANCELLED');
    });

    it('completar sin pagar (PENDING → COMPLETED) y pagar después: el estado no cambia (2.15)', async () => {
      const { id, total } = await newAppointment();
      const done = await http
        .patch(`/api/appointments/${id}/complete`)
        .set(auth(ownerToken));
      expect(done.status).toBe(200);
      expect(await statusOf(id)).toEqual(['COMPLETED', 'PENDING']);
      expect((await pay(id, total)).status).toBe(201);
      expect(await statusOf(id)).toEqual(['COMPLETED', 'COMPLETED']);
    });

    it('cita pagada no se cancela hasta reembolsar todo: APPOINTMENT_PAID (2.15)', async () => {
      const { id, total } = await newAppointment();
      const paid = await pay(id, total);
      for (const attempt of [
        () =>
          http
            .patch(`/api/appointments/${id}/cancel`)
            .set(auth(ownerToken))
            .send({}),
        () =>
          http
            .patch(`/api/appointments/${id}`)
            .set(auth(ownerToken))
            .send({ status: 'CANCELLED' }),
      ]) {
        const res = await attempt();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('APPOINTMENT_PAID');
      }
      const half = Math.round(total * 50) / 100;
      await http
        .post(`/api/payments/${paid.body.id}/refund`)
        .set(auth(ownerToken))
        .send({ refund_amount: half, refund_reason: 'mitad' });
      const stillPaid = await http
        .patch(`/api/appointments/${id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      expect(stillPaid.body.code).toBe('APPOINTMENT_PAID'); // parcial: sigue pagada
      await http
        .post(`/api/payments/${paid.body.id}/refund`)
        .set(auth(ownerToken))
        .send({
          refund_amount: Math.round((total - half) * 100) / 100,
          refund_reason: 'resto',
        });
      const ok = await http
        .patch(`/api/appointments/${id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      expect(ok.status).toBe(200);
      expect(await statusOf(id)).toEqual(['CANCELLED', 'REFUNDED']);
    });

    it('carrera: pago y cancelación simultáneos → nunca una cita CANCELLED con pago COMPLETED', async () => {
      const payments = app.get(PaymentsService);
      const appointments = app.get(AppointmentsService);
      for (let i = 0; i < 5; i++) {
        const { id, total } = await newAppointment();
        await Promise.allSettled([
          payments.create(
            {
              appointment_id: id,
              amount: total,
              payment_method: 'CASH',
            } as any,
            owner.id,
          ),
          appointments.cancel(id, { tenantId: owner.id }),
        ]);
        const [status] = await statusOf(id);
        const completed = await ds.getRepository(Payment).count({
          where: { appointment: { id }, status: 'COMPLETED' as any },
        });
        expect(status === 'CANCELLED' && completed > 0).toBe(false);
        expect([
          ['CANCELLED', 0],
          ['CONFIRMED', 1],
        ]).toContainEqual([status, completed]);
      }
    });

    it('Employee: no agenda para otro profesional (403) ni reseña (403) (2.15)', async () => {
      if (!employeeToken) return;
      const res = await http
        .post('/api/appointments')
        .set(auth(employeeToken))
        .send({
          client_id: client.id,
          professional_id: owner.id,
          service_ids: [service.id],
          date: '2100-01-04T10:00:00-05:00', // el 403 sale antes de mirar la fecha
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      const review = await http
        .post('/api/reviews')
        .set(auth(employeeToken))
        .send({});
      expect(review.status).toBe(403);
    });

    it('carrera: 6 pagos simultáneos a la misma cita → solo 1 COMPLETED', async () => {
      const { id, total } = await newAppointment();
      const payments = app.get(PaymentsService);
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          payments.create(
            {
              appointment_id: id,
              amount: total,
              payment_method: 'CASH',
            } as any,
            owner.id,
          ),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      for (const f of failed) {
        expect(f.reason.message).toBe(
          'Ya existe un pago completado para esta cita',
        );
      }
      const completed = await ds.getRepository(Payment).count({
        where: { appointment: { id }, status: 'COMPLETED' as any },
      });
      expect(completed).toBe(1);
    });

    it('carrera: 2 reembolsos simultáneos del 60 % → solo 1 pasa', async () => {
      const { id, total } = await newAppointment();
      const paid = await pay(id, total);
      const payments = app.get(PaymentsService);
      const sixty = Math.round(total * 60) / 100;
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          payments.refund(
            paid.body.id,
            { refund_amount: sixty, refund_reason: 'carrera' },
            owner.id,
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const stored = await ds
        .getRepository(Payment)
        .findOneByOrFail({ id: paid.body.id });
      expect(Number(stored.refund_amount)).toBe(sixty);
      expect(stored.status).toBe('COMPLETED');
    });
  },
);
