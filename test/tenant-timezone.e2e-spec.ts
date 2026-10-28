/**
 * Tarea 6.02 (D-15): dos negocios en zonas distintas (Bogotá UTC-5 y Caracas
 * UTC-4) sin cruzar horas. Escribe: solo contra una copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`).
 *
 * Cada negocio se da de alta por la API con su zona y agenda con el Owner como
 * profesional, con horario lunes 09:00-11:00. Se comprueba: una cita "a las
 * 08:00" sin offset, horas libres, "solo a futuro" (con la hora del proceso
 * simulada), respuestas con el offset de cada zona y estadísticas por día.
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
import { assertWritableDatabase, describeWritable } from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Lunes lejano (2.21: solo a futuro), antes de la base de los demás specs (2100). */
const MONDAY = '2030-01-07';

interface Business {
  email: string;
  zone: string;
  offset: string;
  token: string;
  ownerId: string;
  clientId: string;
  serviceId: string;
}

describeWritable(
  'Zona horaria por negocio 6.02 (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    let bogota: Business;
    let caracas: Business;

    async function openBusiness(
      zone: string,
      offset: string,
      n: number,
    ): Promise<Business> {
      const email = `tz602-${n}-${run}@example.com`;
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Zona',
        lastname: 'Prueba',
        email,
        phone: `3${(Date.now() + n).toString().slice(-9)}`,
        password: 'Secreta1!',
        timezone: zone,
      });
      expect(reg.status).toBe(201);
      const token = reg.body.token;
      const ownerId = reg.body.user.id;
      const as = (req: any) => req.set(auth(token));

      const category = await as(http.post('/api/categories')).send({
        name: `Cat ${run}`,
      });
      expect(category.status).toBe(201);
      const service = await as(http.post('/api/services')).send({
        name: `Corte ${run}`,
        price: 10000,
        duration: 30,
        categoryId: category.body.id,
      });
      expect(service.status).toBe(201);
      const client = await as(http.post('/api/clients')).send({
        name: 'Cliente',
        lastname: 'Zona',
        phone: `31${(Date.now() + n).toString().slice(-8)}`,
      });
      expect(client.status).toBe(201);
      const schedule = await as(http.post('/api/schedules')).send({
        user_id: ownerId,
        day_of_week: 1,
        start_time: '09:00',
        end_time: '11:00',
        is_available: true,
      });
      expect(schedule.status).toBe(201);
      return {
        email,
        zone,
        offset,
        token,
        ownerId,
        clientId: client.body.id,
        serviceId: service.body.id,
      };
    }

    const book = (b: Business, date: string) =>
      http
        .post('/api/appointments')
        .set(auth(b.token))
        .send({
          client_id: b.clientId,
          professional_id: b.ownerId,
          service_ids: [b.serviceId],
          date,
        });

    const freeSlots = (b: Business, date = MONDAY) =>
      http
        .get(
          `/api/appointments/available-slots?professional_id=${b.ownerId}` +
            `&date=${date}&service_ids=${b.serviceId}&step=30`,
        )
        .set(auth(b.token));

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      // Sin recordatorios ni avisos reales al crear citas.
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      bogota = await openBusiness('America/Bogota', '-05:00', 1);
      caracas = await openBusiness('America/Caracas', '-04:00', 2);
    }, E2E_BOOT_TIMEOUT_MS);

    afterEach(() => jest.useRealTimers());

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('cada negocio tiene su zona en /settings y en /auth/me', async () => {
      for (const b of [bogota, caracas]) {
        const settings = await http.get('/api/settings').set(auth(b.token));
        expect(settings.body).toEqual({ timezone: b.zone });
        const me = await http.get('/api/auth/me').set(auth(b.token));
        expect(me.body.timezone).toBe(b.zone);
      }
    });

    it('horas libres del mismo lunes con el mismo horario 09-11: cada una en su zona y con su offset', async () => {
      const expected = ['09:00', '09:30', '10:00', '10:30'];
      for (const b of [bogota, caracas]) {
        const res = await freeSlots(b);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(
          expected.map((t) => `${MONDAY}T${t}:00.000${b.offset}`),
        );
      }
      // Mismo texto, instantes distintos: 09:00 Bogotá = 14:00Z; Caracas = 13:00Z.
      const [b0] = (await freeSlots(bogota)).body;
      const [c0] = (await freeSlots(caracas)).body;
      expect(new Date(b0).toISOString()).toBe(`${MONDAY}T14:00:00.000Z`);
      expect(new Date(c0).toISOString()).toBe(`${MONDAY}T13:00:00.000Z`);
    });

    it('una cita "a las 09:00" sin offset es las 09:00 de cada negocio y sale con su offset', async () => {
      for (const b of [bogota, caracas]) {
        const res = await book(b, `${MONDAY}T09:00:00`);
        expect(res.status).toBe(201);
        expect(res.body.date).toBe(`${MONDAY}T09:00:00.000${b.offset}`);
        const [row] = await ds.query(
          `SELECT to_char("date" AT TIME ZONE 'UTC', 'HH24:MI') AS utc
           FROM appointments WHERE id = $1`,
          [res.body.id],
        );
        expect(row.utc).toBe(b === bogota ? '14:00' : '13:00');
        // El hueco ocupado desaparece de SUS horas libres.
        expect((await freeSlots(b)).body[0]).toBe(
          `${MONDAY}T09:30:00.000${b.offset}`,
        );
      }
    });

    it('el horario se aplica en la zona de cada negocio: 13:30Z cabe en Caracas (09:30) y no en Bogotá (08:30)', async () => {
      const outside = await book(bogota, `${MONDAY}T13:30:00Z`);
      expect([outside.status, outside.body.code]).toEqual([
        409,
        'SLOT_UNAVAILABLE',
      ]);
      const inside = await book(caracas, `${MONDAY}T13:30:00Z`);
      expect(inside.status).toBe(201);
      expect(inside.body.date).toBe(`${MONDAY}T09:30:00.000-04:00`);
    });

    it('"solo a futuro": a las 13:30Z las 09:00 ya pasaron en Caracas pero no en Bogotá', async () => {
      jest.useFakeTimers({
        now: new Date(`${MONDAY}T13:30:00Z`),
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'clearTimeout',
          'clearInterval',
          'queueMicrotask',
        ],
      });
      // El JWT de antes "venció" en 2030: sesión nueva con la hora simulada.
      const relogin = async (b: Business): Promise<Business> => {
        const res = await http
          .post('/api/auth/login')
          .send({ email: b.email, password: 'Secreta1!' });
        expect(res.status).toBe(200);
        return { ...b, token: res.body.token };
      };
      const caracasNow = await relogin(caracas);
      const bogotaNow = await relogin(bogota);
      const future = await book(caracasNow, `${MONDAY}T10:00:00`); // 14:00Z: futuro
      expect(future.status).toBe(201);
      const tooLate = await book(caracasNow, `${MONDAY}T09:00:00`); // 13:00Z: pasado
      expect([tooLate.status, tooLate.body.code]).toEqual([
        400,
        'APPOINTMENT_IN_PAST',
      ]);
      const stillFuture = await book(bogotaNow, `${MONDAY}T10:00:00`); // 15:00Z
      expect(stillFuture.status).toBe(201);
      // Horas libres de hoy: Caracas ya no ofrece las 09:00 (pasadas).
      const slots = (await freeSlots(caracasNow)).body as string[];
      expect(
        slots.every((s) => new Date(s) >= new Date(`${MONDAY}T13:30:00Z`)),
      ).toBe(true);
    });

    it('estadísticas por día: un pago a las 04:30Z cuenta el 7 en Caracas y el 6 en Bogotá', async () => {
      const paid: Record<string, string> = {};
      for (const b of [bogota, caracas]) {
        const appointment = await book(b, `${MONDAY}T10:30:00`);
        expect(appointment.status).toBe(201);
        const payment = await http
          .post('/api/payments')
          .set(auth(b.token))
          .send({
            appointment_id: appointment.body.id,
            amount: 10000,
            payment_method: 'CASH',
          });
        expect(payment.status).toBe(201);
        paid[b.ownerId] = payment.body.id;
      }
      // Mismo instante para los dos: 6 de enero 23:30 Bogotá / 7 de enero 00:30 Caracas.
      await ds.query(
        `UPDATE payments SET created_at = '${MONDAY}T04:30:00Z' WHERE id = ANY($1)`,
        [Object.values(paid)],
      );

      const statsOf = async (b: Business, from: string, to: string) =>
        (
          await http
            .get(`/api/payments/stats?startDate=${from}&endDate=${to}`)
            .set(auth(b.token))
        ).body;
      expect((await statsOf(caracas, MONDAY, MONDAY)).payment_count).toBe(1);
      expect((await statsOf(bogota, MONDAY, MONDAY)).payment_count).toBe(0);
      expect(
        (await statsOf(bogota, '2030-01-06', '2030-01-06')).payment_count,
      ).toBe(1);

      const dailyOf = async (b: Business) => {
        const res = await http
          .get(
            `/api/payments/employee-stats?startDate=2030-01-06&endDate=${MONDAY}` +
              `&professionalId=${b.ownerId}`,
          )
          .set(auth(b.token));
        expect(res.status).toBe(200);
        return res.body.daily_evolution.map((d: { date: string }) => d.date);
      };
      expect(await dailyOf(bogota)).toEqual(['2030-01-06']);
      expect(await dailyOf(caracas)).toEqual([MONDAY]);
    });

    it('una ruta pública responde sus fechas en UTC (sin tenant): el alta devuelve `Z`', async () => {
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Zona',
        lastname: 'Publica',
        email: `tz602-pub-${run}@example.com`,
        phone: `3${(Date.now() + 9).toString().slice(-9)}`,
        password: 'Secreta1!',
        timezone: 'America/Caracas',
      });
      expect(reg.status).toBe(201);
      expect(reg.body.user.created_at).toMatch(/Z$/);
    });
  },
);
