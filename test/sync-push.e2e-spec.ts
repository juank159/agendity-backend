/**
 * Tarea 10.01b (D-18): `POST /sync/push`. Escribe: solo contra una copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`), con un negocio nuevo: la dueña
 * (atiende sin horario propio), una empleada (lunes 09-18, hace el servicio)
 * y un segundo negocio para los ids ajenos. Un test por cada fila de §4,
 * idempotencia y dos dispositivos (uno sin conexión) sin perder nada.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { signToken } from './utils/dev-fixtures';
import {
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Lunes a futuro, antes de la base de los demás specs. */
const MONDAY = '2031-05-05';
const NEXT_MONDAY = '2031-05-12';

describeWritable(
  'Sincronización: subida 10.01b (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    let ownerToken: string;
    let ownerId: string;
    let employeeToken: string;
    let employeeId: string;
    let otherToken: string;
    let serviceId: string;
    let clientId: string;
    let phoneSeq = 0;

    const phone = () =>
      `3${(Date.now() % 1e7).toString().padStart(7, '0')}${(phoneSeq++ % 100)
        .toString()
        .padStart(2, '0')}`;
    const now = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
    const m = (
      type: string,
      entity_id: string | undefined,
      payload: Record<string, unknown> = {},
      client_time = now(),
    ) => ({ mutation_id: randomUUID(), type, entity_id, payload, client_time });

    async function push(token: string, mutations: any[], device = 'tablet') {
      const res = await http
        .post('/api/sync/push')
        .set(auth(token))
        .send({ device_id: device, mutations });
      expect(res.status).toBe(200);
      return res.body.results as any[];
    }

    async function newAppointment(professional: string, at: string) {
      const res = await http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: clientId,
          professional_id: professional,
          service_ids: [serviceId],
          date: at,
        });
      expect(res.status).toBe(201);
      return res.body;
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = async (n: number) => {
        const res = await http.post('/api/auth/register/owner').send({
          name: 'Dueña',
          lastname: 'Push',
          email: `push-${n}-${run}@example.com`,
          phone: `3${(Date.now() + n).toString().slice(-9)}`,
          password: 'Secreta1!',
        });
        expect(res.status).toBe(201);
        return res.body;
      };
      const a = await reg(1);
      ownerToken = a.token;
      ownerId = a.user.id;
      otherToken = (await reg(2)).token;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const as = (req: any) => req.set(auth(ownerToken));
      const category = await as(http.post('/api/categories')).send({
        name: `Cejas ${run}`,
      });
      serviceId = (
        await as(http.post('/api/services')).send({
          name: `Diseño ${run}`,
          price: 30000,
          duration: 60,
          categoryId: category.body.id,
        })
      ).body.id;
      clientId = (
        await as(http.post('/api/clients')).send({
          name: 'Ana',
          lastname: 'Push',
          phone: phone(),
        })
      ).body.id;
      const emp = await as(http.post('/api/auth/register/employee')).send({
        name: 'Laura',
        lastname: 'Push',
        email: `push-emp-${run}@example.com`,
        phone: `3${(Date.now() + 9).toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      employeeId = emp.body.user.id;
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
        [employeeId],
      );
      await as(http.post(`/api/users/${employeeId}/services/batch`)).send([
        { serviceId },
      ]);
      await as(http.post('/api/schedules')).send({
        user_id: employeeId,
        day_of_week: 1,
        start_time: '09:00',
        end_time: '18:00',
        is_available: true,
      });
      employeeToken = signToken(
        {
          id: employeeId,
          name: 'Laura',
          email: `push-emp-${run}@example.com`,
          owner: { id: ownerId },
        },
        ['Employee'],
      );
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('ids de la app en las rutas de crear: se respetan; repetido o de otro negocio → 409', async () => {
      const id = randomUUID();
      const created = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ id, name: 'Con id', lastname: 'App', phone: phone() });
      expect([created.status, created.body.id]).toEqual([201, id]);
      const again = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ id, name: 'Otra', lastname: 'App', phone: phone() });
      expect([again.status, again.body.code]).toEqual([409, 'CONFLICT']);
      const foreign = await http
        .post('/api/clients')
        .set(auth(otherToken))
        .send({ id, name: 'Ajena', lastname: 'App', phone: phone() });
      expect([foreign.status, foreign.body.code]).toEqual([409, 'CONFLICT']);
      // El PATCH no deja cambiar el id.
      const patch = await http
        .patch(`/api/clients/${id}`)
        .set(auth(ownerToken))
        .send({ id: randomUUID() });
      expect(patch.status).toBe(400);
    });

    it('§4 cita en un hueco ocupado: se guarda en conflicto, no ocupa hueco, se lista y se resuelve moviéndola', async () => {
      const online = await newAppointment(employeeId, `${MONDAY}T10:00:00`);
      const id = randomUUID();
      const [result] = await push(ownerToken, [
        m('appointment.create', id, {
          client_id: clientId,
          professional_id: employeeId,
          service_ids: [serviceId],
          date: `${MONDAY}T10:00:00`,
        }),
      ]);
      expect(result).toMatchObject({
        status: 'conflict',
        code: 'SLOT_UNAVAILABLE',
        saved: true,
        entity_id: id,
      });
      const [row] = await ds.query(
        'SELECT needs_reschedule, sync_conflict FROM appointments WHERE id = $1',
        [id],
      );
      expect(row).toEqual({
        needs_reschedule: true,
        sync_conflict: 'SLOT_UNAVAILABLE',
      });
      // Visible en la lista de conflictos (Owner y la empleada, que es la suya).
      for (const token of [ownerToken, employeeToken]) {
        const list = await http
          .get('/api/appointments/conflicts')
          .set(auth(token));
        expect(list.body.map((a: any) => a.id)).toContain(id);
      }
      // No ocupa hueco: cancelada la de la app, las 10:00 vuelven a estar libres.
      await http
        .patch(`/api/appointments/${online.id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      const slots = await http
        .get(
          `/api/appointments/available-slots?professional_id=${employeeId}` +
            `&date=${MONDAY}&service_ids=${serviceId}&step=60`,
        )
        .set(auth(ownerToken));
      expect(slots.body).toContain(`${MONDAY}T10:00:00.000-05:00`);
      // Moverla a una hora libre resuelve el conflicto.
      const moved = await http
        .patch(`/api/appointments/${id}`)
        .set(auth(ownerToken))
        .send({ date: `${MONDAY}T13:00:00` });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({
        needsReschedule: false,
        syncConflict: null,
      });
      const after = await http
        .get('/api/appointments/conflicts')
        .set(auth(ownerToken));
      expect(after.body.map((a: any) => a.id)).not.toContain(id);
    });

    it('§4 edición concurrente de un cliente: última escritura gana por campo', async () => {
      const newPhone = phone();
      const results = [
        ...(await push(
          ownerToken,
          [m('client.update', clientId, { lastname: 'Desde la tablet' })],
          'tablet',
        )),
        ...(await push(
          employeeToken,
          [
            m('client.update', clientId, { phone: newPhone }),
            m('client.update', clientId, { lastname: 'Desde el móvil' }),
          ],
          'movil',
        )),
      ];
      expect(results.map((r) => r.status)).toEqual([
        'applied',
        'applied',
        'applied',
      ]);
      const [row] = await ds.query(
        'SELECT lastname, phone FROM clients WHERE id = $1',
        [clientId],
      );
      expect(row).toEqual({ lastname: 'Desde el móvil', phone: newPhone });
    });

    it('§4 dos dispositivos crean el mismo teléfono: fusión, y lo que llega con el id viejo va al cliente que quedó', async () => {
      const [{ phone: samePhone }] = await ds.query(
        'SELECT phone FROM clients WHERE id = $1',
        [clientId],
      );
      const deviceId = randomUUID();
      const appointmentId = randomUUID();
      const [merged, appointment] = await push(ownerToken, [
        m('client.create', deviceId, {
          name: 'Ana',
          lastname: 'Duplicada',
          phone: samePhone,
        }),
        m('appointment.create', appointmentId, {
          client_id: deviceId,
          professional_id: ownerId,
          service_ids: [serviceId],
          date: `${MONDAY}T16:00:00`,
        }),
      ]);
      expect(merged).toMatchObject({ status: 'merged', merged_into: clientId });
      expect(appointment.status).toBe('applied');
      const [row] = await ds.query(
        'SELECT "clientId" FROM appointments WHERE id = $1',
        [appointmentId],
      );
      expect(row.clientId).toBe(clientId);
      expect(
        await ds.query('SELECT 1 FROM clients WHERE id = $1', [deviceId]),
      ).toHaveLength(0);
    });

    it('§4 cambio de estado inválido (completar una cancelada): conflicto visible, sin cambiar nada', async () => {
      const appt = await newAppointment(ownerId, `${MONDAY}T08:00:00`);
      await http
        .patch(`/api/appointments/${appt.id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      const [result] = await push(ownerToken, [
        m('appointment.complete', appt.id),
      ]);
      expect(result).toMatchObject({
        status: 'conflict',
        code: 'INVALID_STATE_TRANSITION',
      });
      const [row] = await ds.query(
        'SELECT status FROM appointments WHERE id = $1',
        [appt.id],
      );
      expect(row.status).toBe('CANCELLED');
    });

    it('§4 pago sobre una cita cancelada: se guarda en revisión; reembolsado entero, se resuelve', async () => {
      const appt = await newAppointment(ownerId, `${MONDAY}T07:00:00`);
      await http
        .patch(`/api/appointments/${appt.id}/cancel`)
        .set(auth(ownerToken))
        .send({});
      const paymentId = randomUUID();
      const [result] = await push(ownerToken, [
        m('payment.create', paymentId, {
          appointment_id: appt.id,
          amount: 30000,
          payment_method: 'CASH',
        }),
      ]);
      expect(result).toMatchObject({
        status: 'conflict',
        code: 'APPOINTMENT_CANCELLED',
        saved: true,
      });
      const review = await http
        .get('/api/payments/review')
        .set(auth(ownerToken));
      expect(review.body.map((p: any) => p.id)).toContain(paymentId);
      const refund = await http
        .post(`/api/payments/${paymentId}/refund`)
        .set(auth(ownerToken))
        .send({ refund_amount: 30000, refund_reason: 'Cita cancelada' });
      expect(refund.status).toBe(201);
      const [row] = await ds.query(
        'SELECT review_required FROM payments WHERE id = $1',
        [paymentId],
      );
      expect(row.review_required).toBeNull();
    });

    it('§4 pagos que juntos superan el total: el que sobra queda en revisión y no cuenta; reembolsado el exceso, cuenta', async () => {
      const appt = await newAppointment(ownerId, `${MONDAY}T06:00:00`);
      const first = randomUUID();
      const second = randomUUID();
      const results = await push(ownerToken, [
        m('payment.create', first, {
          appointment_id: appt.id,
          amount: 20000,
          payment_method: 'CASH',
        }),
        m('payment.create', second, {
          appointment_id: appt.id,
          amount: 20000,
          payment_method: 'TRANSFER',
        }),
      ]);
      expect(results.map((r) => [r.status, r.code])).toEqual([
        ['applied', undefined],
        ['conflict', 'OVERPAID'],
      ]);
      const status = async () =>
        (
          await ds.query(
            'SELECT payment_status FROM appointments WHERE id = $1',
            [appt.id],
          )
        )[0].payment_status;
      expect(await status()).toBe('PARTIAL'); // 20.000 de 30.000: el exceso no cuenta
      await http
        .post(`/api/payments/${second}/refund`)
        .set(auth(ownerToken))
        .send({ refund_amount: 10000, refund_reason: 'Exceso' });
      const [row] = await ds.query(
        'SELECT review_required FROM payments WHERE id = $1',
        [second],
      );
      expect(row.review_required).toBeNull();
      expect(await status()).toBe('COMPLETED'); // 20.000 + 10.000
    });

    it('§4 editar algo ya borrado: conflicto NOT_FOUND; borrarlo otra vez: aplicado', async () => {
      const id = randomUUID();
      await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ id, name: 'Borrable', lastname: 'Push', phone: phone() });
      await http.delete(`/api/clients/${id}`).set(auth(ownerToken));
      const [update, remove] = await push(ownerToken, [
        m('client.update', id, { name: 'Tarde' }),
        m('client.delete', id),
      ]);
      expect(update).toMatchObject({ status: 'conflict', code: 'NOT_FOUND' });
      expect(remove.status).toBe('applied');
    });

    it('§4 trial agotado: rejected sin guardarse; con cupo, la MISMA mutación entra', async () => {
      await resetTrialQuota(ds, ownerId, { used: 20, limit: 20 });
      const mutation = m('appointment.create', randomUUID(), {
        client_id: clientId,
        professional_id: ownerId,
        service_ids: [serviceId],
        date: `${NEXT_MONDAY}T09:00:00`,
      });
      const [rejected] = await push(ownerToken, [mutation]);
      expect(rejected).toMatchObject({
        status: 'rejected',
        code: 'TRIAL_LIMIT_REACHED',
      });
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const [applied] = await push(ownerToken, [mutation]);
      expect(applied.status).toBe('applied');
    });

    it('hora del dispositivo: una cita creada sin conexión para dentro de 1 h y subida 2 h después entra; fuera de ventana o antes de crearla, rejected', async () => {
      const hour = 3_600_000;
      const start = new Date(Date.now() - hour).toISOString(); // ya pasó para el servidor
      const [ok, past, tooOld, future] = await push(ownerToken, [
        m(
          'appointment.create',
          randomUUID(),
          {
            client_id: clientId,
            professional_id: ownerId,
            service_ids: [serviceId],
            date: start,
          },
          now(-2 * hour),
        ),
        m(
          'appointment.create',
          randomUUID(),
          {
            client_id: clientId,
            professional_id: ownerId,
            service_ids: [serviceId],
            date: new Date(Date.now() - 3 * hour).toISOString(),
          },
          now(-2 * hour),
        ),
        m('client.update', clientId, { notes: 'x' }, now(-31 * 24 * hour)),
        m('client.update', clientId, { notes: 'y' }, now(10 * 60_000)),
      ]);
      expect(ok.status).toBe('applied');
      expect([past.status, past.code]).toEqual([
        'rejected',
        'APPOINTMENT_IN_PAST',
      ]);
      expect([tooOld.status, tooOld.code]).toEqual([
        'rejected',
        'VALIDATION_ERROR',
      ]);
      expect([future.status, future.code]).toEqual([
        'rejected',
        'VALIDATION_ERROR',
      ]);
    });

    it('permisos de la ruta online: la empleada no registra pagos ni borra clientes', async () => {
      const [payment, removal] = await push(employeeToken, [
        m('payment.create', randomUUID(), {
          appointment_id: randomUUID(),
          amount: 1000,
          payment_method: 'CASH',
        }),
        m('client.delete', clientId),
      ]);
      expect([payment.status, payment.code]).toEqual(['rejected', 'FORBIDDEN']);
      expect([removal.status, removal.code]).toEqual(['rejected', 'FORBIDDEN']);
    });

    it('idempotencia: el mismo lote dos veces da los mismos resultados y ninguna fila de más', async () => {
      const batch = [
        m('client.create', randomUUID(), {
          name: 'Idem',
          lastname: 'Potente',
          phone: phone(),
        }),
        m('appointment.create', randomUUID(), {
          client_id: clientId,
          professional_id: ownerId,
          service_ids: [serviceId],
          date: `${NEXT_MONDAY}T11:00:00`,
        }),
      ];
      const count = async () =>
        (
          await ds.query(
            `SELECT (SELECT count(*) FROM clients WHERE owner_id = $1)::int AS c,
                  (SELECT count(*) FROM appointments WHERE owner_id = $1)::int AS a`,
            [ownerId],
          )
        )[0];
      const first = await push(ownerToken, batch);
      const before = await count();
      const second = await push(ownerToken, batch);
      expect(second).toEqual(first);
      expect(await count()).toEqual(before);
      expect(first.map((r) => r.status)).toEqual(['applied', 'applied']);
    });

    it('dos dispositivos, uno sin conexión: nada se pierde (conteo por id) y los dos convergen', async () => {
      // B (la empleada) sigue en línea y agenda.
      const online = await newAppointment(
        employeeId,
        `${NEXT_MONDAY}T14:00:00`,
      );
      // A (la dueña) estuvo sin conexión: encoló todo esto antes.
      const offline = Array.from({ length: 6 }, (_, i) => ({
        client: randomUUID(),
        appointment: randomUUID(),
        payment: randomUUID(),
        at: `${NEXT_MONDAY}T${String(9 + i).padStart(2, '0')}:00:00`,
      }));
      const mutations = offline.flatMap((o, i) => [
        m(
          'client.create',
          o.client,
          { name: `Sin red ${i}`, lastname: 'A', phone: phone() },
          now(-60_000),
        ),
        m(
          'appointment.create',
          o.appointment,
          {
            client_id: o.client,
            // Una de ellas choca con la de la empleada (14:00).
            professional_id: employeeId,
            service_ids: [serviceId],
            date: i === 5 ? `${NEXT_MONDAY}T14:00:00` : o.at,
          },
          now(-60_000),
        ),
        m(
          'payment.create',
          o.payment,
          {
            appointment_id: o.appointment,
            amount: 30000,
            payment_method: 'CASH',
          },
          now(-60_000),
        ),
      ]);
      const results = await push(ownerToken, mutations, 'tablet-sin-red');
      expect(results).toHaveLength(mutations.length);
      expect(
        results.every((r) => ['applied', 'conflict'].includes(r.status)),
      ).toBe(true);
      const conflicts = results.filter((r) => r.status === 'conflict');
      expect(conflicts).toEqual([
        expect.objectContaining({
          entity_id: offline[5].appointment,
          code: 'SLOT_UNAVAILABLE',
          saved: true,
        }),
      ]);
      // Conteo por id: cada cliente, cita y pago existe.
      for (const [table, ids] of [
        ['clients', offline.map((o) => o.client)],
        ['appointments', offline.map((o) => o.appointment)],
        ['payments', offline.map((o) => o.payment)],
      ] as const) {
        const [{ n }] = await ds.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`,
          [ids],
        );
        expect([table, n]).toEqual([table, 6]);
      }
      // Convergen: la bajada de cada uno trae lo que le toca.
      const pull = async (token: string) => {
        const ids = new Set<string>();
        let cursor = '0';
        for (let i = 0; i < 100; i++) {
          const res = await http
            .get(`/api/sync/changes?cursor=${cursor}&limit=200`)
            .set(auth(token));
          res.body.changes.forEach((c: any) => ids.add(c.id));
          cursor = res.body.cursor;
          if (!res.body.has_more) break;
        }
        return ids;
      };
      const ownerView = await pull(ownerToken);
      const employeeView = await pull(employeeToken);
      for (const o of offline) {
        expect(ownerView.has(o.client)).toBe(true);
        expect(ownerView.has(o.appointment)).toBe(true);
        expect(ownerView.has(o.payment)).toBe(true);
        expect(employeeView.has(o.appointment)).toBe(true); // son suyas
        expect(employeeView.has(o.payment)).toBe(false); // sin pagos
      }
      expect(employeeView.has(online.id)).toBe(true);
    });
  },
);
