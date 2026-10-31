/**
 * Fase 11.01 y 11.02: recordatorios automáticos configurables. Escribe: solo
 * contra una copia (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`), con dos
 * negocios nuevos (Bogotá y Caracas). El motor se ejecuta a mano con una hora
 * simulada (`runOnce(now, tenantId)`); el canal es el simulado (`LogChannel`).
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { signToken } from './utils/dev-fixtures';
import { assertWritableDatabase, describeWritable } from './utils/writable-db';
import { ReminderEngineService } from 'src/reminders/reminder-engine.service';
import { MESSAGING_CHANNEL } from 'src/reminders/channels/messaging-channel';
import { LogChannel } from 'src/reminders/channels/log.channel';
import { TRIAL_WHATSAPP_QUOTA } from 'src/reminders/reminder-kinds';
import { PAID_PLAN_IDS } from 'src/migrations/1793460000000-WhatsappQuotaPlans';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SECRET = 'app-secret-de-prueba';
const VERIFY = 'verify-token-de-prueba';
const at = (iso: string) => new Date(iso);

describeWritable(
  'Recordatorios automáticos, Fase 11 (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let engine: ReminderEngineService;
    let channel: LogChannel;
    const run = randomUUID().slice(0, 8);
    const env = { ...process.env };
    let seq = 0;

    const bogota = { token: '', id: '', serviceId: '' };
    const caracas = { token: '', id: '', serviceId: '' };

    const phone = () => `3${String(Date.now() + ++seq).slice(-9)}`;

    async function register(zone: string) {
      const res = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Recordatorios',
        email: `rem-${++seq}-${run}@example.com`,
        phone: phone(),
        password: 'Secreta1!',
        business_name: `Salón ${zone.split('/')[1]} ${run}`,
        timezone: zone,
      });
      expect(res.status).toBe(201);
      return {
        token: res.body.token as string,
        id: res.body.user.id as string,
      };
    }

    const as = (t: { token: string }) => ({
      get: (p: string) => http.get(p).set(auth(t.token)),
      post: (p: string) => http.post(p).set(auth(t.token)),
      put: (p: string) => http.put(p).set(auth(t.token)),
      patch: (p: string) => http.patch(p).set(auth(t.token)),
      delete: (p: string) => http.delete(p).set(auth(t.token)),
    });

    async function client(
      t: { token: string },
      over: Record<string, unknown> = {},
    ): Promise<string> {
      const res = await as(t)
        .post('/api/clients')
        .send({ name: 'Ana', lastname: 'Cliente', phone: phone(), ...over });
      expect(res.status).toBe(201);
      return res.body.id;
    }

    async function appointment(
      t: { token: string; id: string; serviceId: string },
      clientId: string,
      date: string,
      serviceId = t.serviceId,
    ): Promise<string> {
      const res = await as(t)
        .post('/api/appointments')
        .send({
          client_id: clientId,
          professional_id: t.id,
          service_ids: [serviceId],
          date,
        });
      expect(res.status).toBe(201);
      return res.body.id;
    }

    async function rule(t: { token: string }, body: Record<string, unknown>) {
      const res = await as(t).post('/api/reminders/rules').send(body);
      expect(res.status).toBe(201);
      return res.body.id as string;
    }

    const deliveries = (where: string, params: unknown[]) =>
      ds.query(
        `SELECT kind, status, reason, phone, body, provider_message_id, client_id,
                appointment_id, next_attempt_at
           FROM reminder_deliveries WHERE ${where} ORDER BY created_at`,
        params,
      );

    async function service(
      t: { token: string },
      over: Record<string, unknown> = {},
    ): Promise<string> {
      const category = await as(t)
        .post('/api/categories')
        .send({ name: `Uñas ${++seq} ${run}` });
      const res = await as(t)
        .post('/api/services')
        .send({
          name: `Manicure ${++seq} ${run}`,
          price: 30000,
          duration: 30,
          categoryId: category.body.id,
          ...over,
        });
      expect(res.status).toBe(201);
      return res.body.id;
    }

    beforeAll(async () => {
      process.env.WHATSAPP_APP_SECRET = SECRET;
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY;
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      engine = app.get(ReminderEngineService);
      channel = app.get(MESSAGING_CHANNEL);
      expect(channel.name).toBe('log');

      Object.assign(bogota, await register('America/Bogota'));
      Object.assign(caracas, await register('America/Caracas'));
      bogota.serviceId = await service(bogota);
      caracas.serviceId = await service(caracas);
      for (const t of [bogota, caracas]) {
        const res = await as(t).put('/api/reminders/settings').send({
          enabled: true,
          send_window_start: '08:00',
          send_window_end: '20:00',
        });
        expect(res.status).toBe(200);
      }
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      process.env = env;
      jest.restoreAllMocks();
      await close();
    });

    it('D-21: cada plan pagado trae 300 mensajes al mes y el trial 10', async () => {
      const plans = await ds.query(
        `SELECT whatsapp_monthly_quota AS q FROM subscription_plans WHERE id = ANY($1::uuid[])`,
        [PAID_PLAN_IDS],
      );
      expect(plans.map((p: any) => p.q)).toEqual([300, 300, 300]);
      expect(TRIAL_WHATSAPP_QUOTA).toBe(10);
    });

    it('configuración y reglas: solo el Owner, por negocio, validadas', async () => {
      const settings = await as(bogota).get('/api/reminders/settings');
      expect(settings.body).toEqual({
        enabled: true,
        send_window_start: '08:00',
        send_window_end: '20:00',
        channel: 'log',
        quota: {
          limit: TRIAL_WHATSAPP_QUOTA,
          used: 0,
          period: expect.stringMatching(/^\d{4}-\d{2}$/),
        },
      });
      const id = await rule(bogota, {
        kind: 'before_appointment',
        minutes_before: 1440,
      });
      const created = await as(bogota).get(`/api/reminders/rules/${id}`);
      expect(created.body).toMatchObject({
        kind: 'before_appointment',
        minutes_before: 1440,
        category: 'utility',
        send_time: null,
        is_active: true,
      });
      expect(created.body.template).toContain('{cliente}');

      // Duplicado, variable desconocida, tipo sin su dato, categoría de Meta.
      const dup = await as(bogota)
        .post('/api/reminders/rules')
        .send({ kind: 'before_appointment', minutes_before: 1440 });
      expect([dup.status, dup.body.code]).toEqual([409, 'CONFLICT']);
      const badVar = await as(bogota).post('/api/reminders/rules').send({
        kind: 'before_appointment',
        minutes_before: 60,
        template: 'Hola {nombre}',
      });
      expect([badVar.status, badVar.body.code]).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
      const noDays = await as(bogota)
        .post('/api/reminders/rules')
        .send({ kind: 'win_back' });
      expect(noDays.status).toBe(400);
      const utilityBirthday = await as(bogota)
        .post('/api/reminders/rules')
        .send({ kind: 'birthday', category: 'utility' });
      expect(utilityBirthday.status).toBe(400);

      // Otro negocio: 404. Employee: 403. Sin sesión: 401.
      expect((await as(caracas).get(`/api/reminders/rules/${id}`)).status).toBe(
        404,
      );
      expect(
        (await as(caracas).delete(`/api/reminders/rules/${id}`)).status,
      ).toBe(404);
      const emp = await as(bogota)
        .post('/api/auth/register/employee')
        .send({
          name: 'Laura',
          lastname: 'Empleada',
          email: `rem-emp-${run}@example.com`,
          phone: phone(),
          password: 'Secreta1!',
        });
      expect(emp.status).toBe(201);
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
        [emp.body.user.id],
      );
      const employee = signToken(
        {
          id: emp.body.user.id,
          name: 'Laura',
          email: `rem-emp-${run}@example.com`,
          owner: { id: bogota.id },
        },
        ['Employee'],
      );
      expect(
        (await http.get('/api/reminders/rules').set(auth(employee))).status,
      ).toBe(403);
      expect((await http.get('/api/reminders/settings')).status).toBe(401);

      const preview = await as(bogota)
        .post('/api/reminders/rules/preview')
        .send({
          kind: 'before_appointment',
          template: '{cliente} en {negocio} a las {hora}',
        });
      expect(preview.body.text).toMatch(/^Ana en Salón Bogota .+ a las /);

      await rule(bogota, { kind: 'before_appointment', minutes_before: 30 });
    });

    it('antes de la cita (24 h y 30 min): una entrega por regla y fecha; el cron dos veces no envía doble', async () => {
      const c = await client(bogota, { whatsapp_opt_in: true });
      // 10:00 en Bogotá = 15:00Z.
      const id = await appointment(bogota, c, '2031-03-17T10:00:00');
      const before = channel.sent.length;

      const first = await engine.runOnce(at('2031-03-16T15:01:00Z'), bogota.id);
      expect(first).toMatchObject({ planned: 1, sent: 1 });
      const again = await engine.runOnce(at('2031-03-16T15:02:00Z'), bogota.id);
      expect(again).toMatchObject({ planned: 0, sent: 0 });
      expect(channel.sent.length).toBe(before + 1);
      const message = channel.sent[channel.sent.length - 1];
      expect(message).toMatchObject({
        kind: 'before_appointment',
        category: 'utility',
        templateName: 'agendity_recordatorio_cita',
      });
      expect(message.to).toMatch(/^\+573\d{9}$/);
      expect(message.params[1]).toBe(`Salón Bogota ${run}`);
      expect(message.text).toContain('10:00');

      await engine.runOnce(at('2031-03-17T14:31:00Z'), bogota.id);
      await engine.runOnce(at('2031-03-17T14:32:00Z'), bogota.id);
      const rows = await deliveries('appointment_id = $1', [id]);
      expect(rows.map((r: any) => r.status)).toEqual(['sent', 'sent']);
      expect(new Set(rows.map((r: any) => r.provider_message_id)).size).toBe(2);
    });

    it('D-21: sin consentimiento tampoco hay recordatorio de cita (skipped NO_CONSENT, sin enviar)', async () => {
      const c = await client(bogota);
      const id = await appointment(bogota, c, '2031-03-17T16:00:00');
      const before = channel.sent.length;
      await engine.runOnce(at('2031-03-16T21:01:00Z'), bogota.id);
      expect(await deliveries('appointment_id = $1', [id])).toMatchObject([
        { status: 'skipped', reason: 'NO_CONSENT' },
      ]);
      expect(channel.sent.length).toBe(before);
    });

    it('ventana horaria: fuera se corre al inicio; si eso ya es después de la cita, no se manda', async () => {
      const c = await client(bogota, { whatsapp_opt_in: true });
      // 08:10 local: el de 30 min tocaba a las 07:40 → se corre a las 08:00.
      const early = await appointment(bogota, c, '2031-03-18T08:10:00');
      // 07:30 local: el de 30 min tocaba a las 07:00 → las 08:00 ya es tarde.
      const tooEarly = await appointment(bogota, c, '2031-03-19T07:30:00');

      const r1 = await engine.runOnce(at('2031-03-18T12:41:00Z'), bogota.id);
      expect(r1.deferred).toBeGreaterThanOrEqual(1);
      let [row] = await deliveries(
        `appointment_id = $1 AND rule_id = (SELECT id FROM reminder_rules WHERE owner_id = $2 AND minutes_before = 30)`,
        [early, bogota.id],
      );
      expect(row.status).toBe('queued');
      expect(new Date(row.next_attempt_at).toISOString()).toBe(
        '2031-03-18T13:00:00.000Z',
      );
      await engine.runOnce(at('2031-03-18T13:00:00Z'), bogota.id);
      [row] = await deliveries(
        `appointment_id = $1 AND rule_id = (SELECT id FROM reminder_rules WHERE owner_id = $2 AND minutes_before = 30)`,
        [early, bogota.id],
      );
      expect(row.status).toBe('sent');

      await engine.runOnce(at('2031-03-19T12:01:00Z'), bogota.id);
      const late = await deliveries(
        `appointment_id = $1 AND rule_id = (SELECT id FROM reminder_rules WHERE owner_id = $2 AND minutes_before = 30)`,
        [tooEarly, bogota.id],
      );
      expect(late).toMatchObject([{ status: 'skipped', reason: 'TOO_LATE' }]);
    });

    it('cupo mensual: agotado → skipped QUOTA y un solo aviso al Owner', async () => {
      const c = await client(bogota, { whatsapp_opt_in: true });
      const a1 = await appointment(bogota, c, '2031-04-07T11:00:00');
      const a2 = await appointment(bogota, c, '2031-04-07T15:00:00');
      await ds.query(
        `INSERT INTO whatsapp_usage (owner_id, period, used) VALUES ($1, '2031-04', $2)`,
        [bogota.id, TRIAL_WHATSAPP_QUOTA],
      );
      await engine.runOnce(at('2031-04-06T21:00:00Z'), bogota.id);
      const rows = await deliveries(
        `appointment_id = ANY($1::uuid[]) AND rule_id = (SELECT id FROM reminder_rules WHERE owner_id = $2 AND minutes_before = 1440)`,
        [[a1, a2], bogota.id],
      );
      expect(rows.map((r: any) => [r.status, r.reason])).toEqual([
        ['skipped', 'QUOTA'],
        ['skipped', 'QUOTA'],
      ]);
      const notices = await ds.query(
        `SELECT 1 FROM notifications WHERE receiver_id = $1 AND title = 'Cupo de WhatsApp agotado'`,
        [bogota.id],
      );
      expect(notices).toHaveLength(1);
      const usage = await as(bogota).get('/api/reminders/settings');
      expect(usage.body.quota).toBeDefined();
      await ds.query(
        `DELETE FROM whatsapp_usage WHERE owner_id = $1 AND period = '2031-04'`,
        [bogota.id],
      );
    });

    it('cumpleaños: a su hora en la zona de CADA negocio (Bogotá contra Caracas) y solo con consentimiento', async () => {
      await rule(bogota, { kind: 'birthday', send_time: '10:00' });
      await rule(caracas, { kind: 'birthday', send_time: '10:00' });
      const withConsent = await client(bogota, {
        birthday: '1990-03-20',
        whatsapp_opt_in: true,
      });
      const withoutConsent = await client(bogota, { birthday: '1991-03-20' });
      const venezuelan = await client(caracas, {
        phone: `0414${String(Date.now()).slice(-7)}`,
        birthday: '1992-03-20',
        whatsapp_opt_in: true,
      });
      const consent = await ds.query(
        'SELECT whatsapp_opt_in, whatsapp_opt_in_at FROM clients WHERE id = $1',
        [withConsent],
      );
      expect(consent[0].whatsapp_opt_in).toBe(true);
      expect(consent[0].whatsapp_opt_in_at).not.toBeNull();

      // 14:30Z = 09:30 en Bogotá (aún no) y 10:30 en Caracas (ya).
      const bog1 = await engine.runOnce(at('2031-03-20T14:30:00Z'), bogota.id);
      const car1 = await engine.runOnce(at('2031-03-20T14:30:00Z'), caracas.id);
      expect(
        await deliveries(`kind = 'birthday' AND client_id = ANY($1::uuid[])`, [
          [withConsent, withoutConsent],
        ]),
      ).toEqual([]);
      expect(bog1.planned).toBe(0);
      expect(car1.sent).toBe(1);
      const [ve] = await deliveries(`kind = 'birthday' AND client_id = $1`, [
        venezuelan,
      ]);
      expect(ve).toMatchObject({ status: 'sent' });
      expect(ve.phone).toMatch(/^\+58414\d{7}$/);

      await engine.runOnce(at('2031-03-20T15:05:00Z'), bogota.id);
      const [yes] = await deliveries(`kind = 'birthday' AND client_id = $1`, [
        withConsent,
      ]);
      const [no] = await deliveries(`kind = 'birthday' AND client_id = $1`, [
        withoutConsent,
      ]);
      expect(yes).toMatchObject({ status: 'sent' });
      expect(no).toMatchObject({ status: 'skipped', reason: 'NO_CONSENT' });
      // Una vez por año: otra pasada el mismo día no repite.
      expect(
        (await engine.runOnce(at('2031-03-20T18:00:00Z'), bogota.id)).sent,
      ).toBe(0);
    });

    describe('webhook de WhatsApp', () => {
      const post = (body: unknown, signature?: string) => {
        const raw = JSON.stringify(body);
        const req = http
          .post('/api/webhooks/whatsapp')
          .set('Content-Type', 'application/json');
        if (signature !== undefined) req.set('X-Hub-Signature-256', signature);
        return req.send(raw);
      };
      const sign = (body: unknown, key = SECRET) =>
        `sha256=${createHmac('sha256', key).update(JSON.stringify(body)).digest('hex')}`;
      const statusEvent = (id: string, status: string, ts: number) => ({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              { value: { statuses: [{ id, status, timestamp: String(ts) }] } },
            ],
          },
        ],
      });

      it('GET de verificación: devuelve el challenge solo con el token correcto', async () => {
        const ok = await http.get(
          `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`,
        );
        expect([ok.status, ok.text]).toEqual([200, '12345']);
        const bad = await http.get(
          '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1',
        );
        expect(bad.status).toBe(403);
      });

      it('estados: firma inválida → 401 sin cambios; válida → avanza y nunca retrocede', async () => {
        const [sent] = await ds.query(
          `SELECT provider_message_id AS id FROM reminder_deliveries
            WHERE owner_id = $1 AND status = 'sent' LIMIT 1`,
          [bogota.id],
        );
        const delivered = statusEvent(sent.id, 'delivered', 1900000000);
        expect((await post(delivered, sign(delivered, 'otro'))).status).toBe(
          401,
        );
        expect((await post(delivered)).status).toBe(401);
        expect((await post(delivered, 'sha256=00')).status).toBe(401);
        let [row] = await deliveries('provider_message_id = $1', [sent.id]);
        expect(row.status).toBe('sent');

        expect((await post(delivered, sign(delivered))).status).toBe(200);
        const read = statusEvent(sent.id, 'read', 1900000100);
        expect((await post(read, sign(read))).body).toMatchObject({
          statuses: 1,
        });
        // Un "delivered" repetido o fuera de orden no deshace el "read".
        expect((await post(delivered, sign(delivered))).body).toMatchObject({
          statuses: 0,
        });
        [row] = await deliveries('provider_message_id = $1', [sent.id]);
        expect(row.status).toBe('read');
      });

      it('baja: "STOP" en respuesta a un mensaje da de baja a ese cliente; ya no recibe ni recordatorios de cita', async () => {
        const c = await client(bogota, { whatsapp_opt_in: true });
        const id = await appointment(bogota, c, '2031-05-05T11:00:00');
        await engine.runOnce(at('2031-05-04T16:01:00Z'), bogota.id);
        const [first] = await deliveries(`appointment_id = $1`, [id]);
        expect(first.status).toBe('sent');

        const stop = {
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: first.phone.replace('+', ''),
                        type: 'text',
                        text: { body: 'BAJA' },
                        context: { id: first.provider_message_id },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
        expect((await post(stop, sign(stop))).body).toMatchObject({
          optOuts: 1,
        });
        const [after] = await ds.query(
          'SELECT whatsapp_opt_in, whatsapp_opt_out_at FROM clients WHERE id = $1',
          [c],
        );
        expect(after.whatsapp_opt_in).toBe(false);
        expect(after.whatsapp_opt_out_at).not.toBeNull();

        await engine.runOnce(at('2031-05-05T15:31:00Z'), bogota.id);
        const rows = await deliveries(`appointment_id = $1`, [id]);
        expect(rows[1]).toMatchObject({
          status: 'skipped',
          reason: 'OPTED_OUT',
        });

        // Desde la app: volver a dar el consentimiento lo fecha y borra la baja.
        const again = await as(bogota)
          .patch(`/api/clients/${c}`)
          .send({ whatsapp_opt_in: true });
        expect(again.status).toBe(200);
        expect(again.body).toMatchObject({
          whatsapp_opt_in: true,
          whatsapp_opt_out_at: null,
        });
      });
    });

    it('mantenimiento a los N días y "te extrañamos": solo si el cliente no volvió a agendar', async () => {
      const nails = await service(bogota, { maintenanceDays: 30 });
      const got = await as(bogota).get(`/api/services/${nails}`);
      expect(got.body.maintenanceDays).toBe(30);
      await rule(bogota, { kind: 'maintenance', send_time: '10:00' });
      await rule(bogota, {
        kind: 'win_back',
        days_without_visit: 60,
        send_time: '10:00',
      });

      const lonely = await client(bogota, { whatsapp_opt_in: true });
      const loyal = await client(bogota, { whatsapp_opt_in: true });
      const done = async (clientId: string, hour: string) => {
        const id = await appointment(
          bogota,
          clientId,
          `2031-06-02T${hour}:00:00`,
          nails,
        );
        // Completada el 1 de abril a las 10:00 (no se puede completar antes de empezar por la API).
        await ds.query(
          `UPDATE appointments SET "date" = '2031-04-01T15:00:00Z', status = 'COMPLETED' WHERE id = $1`,
          [id],
        );
      };
      await done(lonely, '10');
      await done(loyal, '11');
      await appointment(bogota, loyal, '2031-04-20T10:00:00', nails);

      // 1 de mayo 10:05 en Bogotá (1 abr + 30 días a las 10:00).
      await engine.runOnce(at('2031-05-01T15:05:00Z'), bogota.id);
      const maintenance = await deliveries(
        `kind = 'maintenance' AND client_id = ANY($1::uuid[])`,
        [[lonely, loyal]],
      );
      expect(maintenance.map((r: any) => [r.client_id, r.status])).toEqual([
        [lonely, 'sent'],
      ]);
      expect(channel.sent[channel.sent.length - 1]).toMatchObject({
        templateName: 'agendity_mantenimiento',
        category: 'marketing',
      });

      // 31 de mayo 10:05 (60 días sin visitas).
      await engine.runOnce(at('2031-05-31T15:05:00Z'), bogota.id);
      const winBack = await deliveries(
        `kind = 'win_back' AND client_id = ANY($1::uuid[])`,
        [[lonely, loyal]],
      );
      expect(winBack.map((r: any) => [r.client_id, r.status])).toEqual([
        [lonely, 'sent'],
      ]);
    });
  },
);
