/**
 * 13.07 (D-26): las franjas del horario de apertura (el almuerzo del negocio)
 * solo cierran el link público. En la app (Owner, Employee, `/sync/push` y
 * sus horas libres) el día cuenta de la primera apertura al último cierre.
 * Antes de abrir, después de cerrar y el día cerrado siguen cerrados en todos
 * los canales; el horario propio de la profesional sigue valiendo.
 * Escribe: solo contra una copia (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`).
 *
 * Negocio nuevo en Bogotá, lunes 08:00–12:00 y 14:00–19:00, martes cerrado.
 * Laura: horario propio lunes 08:00–19:00 de corrido. Marta: con su propio
 * almuerzo (08:00–12:00 y 14:00–19:00). Servicio de 60 min. Cada caso usa un
 * lunes distinto (`monday(n)`) para no cruzarse con los otros.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import {
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
/** Lunes lejano propio de este spec (2032-03-01 + n semanas). */
const monday = (n: number) =>
  new Date(Date.UTC(2032, 2, 1) + n * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
const tuesday = (n: number) =>
  new Date(Date.UTC(2032, 2, 2) + n * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
const FRANJAS = [
  { start: '08:00', end: '12:00' },
  { start: '14:00', end: '19:00' },
];
const TRAMO = [{ start: '08:00', end: '19:00' }];
const PASSWORD = 'Secreta1!';

describeWritable(
  'Apertura de corrido en la app y con franjas en el link público (13.07, D-26, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let ownerToken: string;
    let employeeToken: string;
    let lauraId: string;
    let martaId: string;
    let serviceId: string;
    let clientId: string;
    let slug: string;
    let phoneSeq = 0;
    const run = randomUUID().slice(0, 8);

    const newPhone = () =>
      `3${(Date.now() % 1e8).toString().padStart(8, '0')}${phoneSeq++ % 10}`;
    const appBook = (token: string, at: string, professional = lauraId) =>
      http
        .post('/api/appointments')
        .set(auth(token))
        .send({
          client_id: clientId,
          professional_id: professional,
          service_ids: [serviceId],
          date: at,
        });
    const webBook = (at: string, professional = lauraId) =>
      http.post(`/api/public/businesses/${slug}/bookings`).send({
        service_ids: [serviceId],
        professional_id: professional,
        start: at,
        client: { name: 'Ana', lastname: 'Web', phone: newPhone() },
      });
    const push = (type: string, entityId: string, payload: object) =>
      http
        .post('/api/sync/push')
        .set(auth(ownerToken))
        .send({
          device_id: `tablet-${run}`,
          mutations: [
            {
              mutation_id: randomUUID(),
              type,
              entity_id: entityId,
              client_time: new Date().toISOString(),
              payload,
            },
          ],
        });
    const brief = (res: any) => [res.status, res.body.code, res.body.details];

    async function createEmployee(
      name: string,
      mondaySlots: { start: string; end: string }[],
    ): Promise<string> {
      const res = await http
        .post('/api/auth/register/employee')
        .set(auth(ownerToken))
        .send({
          name,
          lastname: 'Almuerzo',
          email: `d26-${name.toLowerCase()}-${run}@example.com`,
          phone: newPhone(),
          password: PASSWORD,
          services: [{ serviceId }],
          schedule: { monday: mondaySlots },
        });
      expect(res.status).toBe(201);
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
        [res.body.user.id],
      );
      return res.body.user.id;
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      jest
        .spyOn(ThrottlerGuard.prototype, 'canActivate')
        .mockResolvedValue(true);

      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Almuerzo',
        email: `d26-${run}@example.com`,
        phone: newPhone(),
        password: PASSWORD,
        timezone: 'America/Bogota',
        business_name: `Salón Almuerzo ${run}`,
      });
      expect(reg.status).toBe(201);
      ownerToken = reg.body.token;
      await resetTrialQuota(ds, reg.body.user.id, { limit: 1000 });
      const as = (req: any) => req.set(auth(ownerToken));

      const category = await as(http.post('/api/categories')).send({
        name: `Cejas ${run}`,
      });
      const service = await as(http.post('/api/services')).send({
        name: `Diseño ${run}`,
        price: 30000,
        duration: 60,
        categoryId: category.body.id,
        onlineBooking: true,
      });
      expect(service.status).toBe(201);
      serviceId = service.body.id;
      clientId = (
        await as(http.post('/api/clients')).send({
          name: 'Ana',
          lastname: 'Almuerzo',
          phone: newPhone(),
        })
      ).body.id;

      lauraId = await createEmployee('Laura', TRAMO);
      martaId = await createEmployee('Marta', FRANJAS);
      const login = await http.post('/api/auth/login').send({
        email: `d26-laura-${run}@example.com`,
        password: PASSWORD,
      });
      expect(login.status).toBe(200);
      employeeToken = login.body.token;

      const settings = await as(http.patch('/api/settings')).send({
        opening_hours: [
          { day_of_week: 1, start_time: '08:00', end_time: '12:00' },
          { day_of_week: 1, start_time: '14:00', end_time: '19:00' },
        ],
      });
      expect(settings.status).toBe(200);
      slug = settings.body.slug;
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('Owner y Employee agendan a las 12:30 en el almuerzo del negocio (201); el link público no (409 con las franjas)', async () => {
      expect((await appBook(ownerToken, `${monday(0)}T12:30:00`)).status).toBe(
        201,
      );
      expect(
        (await appBook(employeeToken, `${monday(1)}T12:30:00`)).status,
      ).toBe(201);
      const web = await webBook(`${monday(2)}T12:30:00`);
      expect(brief(web)).toEqual([
        409,
        'OUTSIDE_BUSINESS_HOURS',
        { reason: 'OUTSIDE_OPENING_HOURS', hours: FRANJAS },
      ]);
    });

    it('una cita que cruza el almuerzo (11:30–12:30): 201 en la app y 409 en el público', async () => {
      expect((await appBook(ownerToken, `${monday(3)}T11:30:00`)).status).toBe(
        201,
      );
      const web = await webBook(`${monday(4)}T11:30:00`);
      expect(brief(web)).toEqual([
        409,
        'OUTSIDE_BUSINESS_HOURS',
        { reason: 'OUTSIDE_OPENING_HOURS', hours: FRANJAS },
      ]);
    });

    it('antes de abrir y después de cerrar: 409 en todos los canales; en la app `hours` es el tramo del día', async () => {
      const day = monday(5);
      for (const at of [
        `${day}T07:30:00`,
        `${day}T18:30:00`,
        `${day}T19:00:00`,
      ]) {
        for (const token of [ownerToken, employeeToken]) {
          expect(brief(await appBook(token, at))).toEqual([
            409,
            'OUTSIDE_BUSINESS_HOURS',
            { reason: 'OUTSIDE_OPENING_HOURS', hours: TRAMO },
          ]);
        }
        expect(brief(await webBook(at))).toEqual([
          409,
          'OUTSIDE_BUSINESS_HOURS',
          { reason: 'OUTSIDE_OPENING_HOURS', hours: FRANJAS },
        ]);
      }
      // /sync/push la guarda en conflicto (D-18) con el mismo motivo.
      const id = randomUUID();
      const res = await push('appointment.create', id, {
        client_id: clientId,
        professional_id: lauraId,
        service_ids: [serviceId],
        date: `${day}T07:30:00`,
      });
      expect(res.status).toBe(200);
      expect(res.body.results[0]).toMatchObject({
        status: 'conflict',
        code: 'OUTSIDE_BUSINESS_HOURS',
        saved: true,
        details: { reason: 'OUTSIDE_OPENING_HOURS', hours: TRAMO },
      });
    });

    it('día cerrado (martes): 409 BUSINESS_CLOSED_DAY en todos los canales', async () => {
      const at = `${tuesday(6)}T10:00:00`;
      const closed = [
        409,
        'OUTSIDE_BUSINESS_HOURS',
        { reason: 'BUSINESS_CLOSED_DAY', hours: [] },
      ];
      expect(brief(await appBook(ownerToken, at))).toEqual(closed);
      expect(brief(await appBook(employeeToken, at))).toEqual(closed);
      expect(brief(await webBook(at))).toEqual(closed);
      const res = await push('appointment.create', randomUUID(), {
        client_id: clientId,
        professional_id: lauraId,
        service_ids: [serviceId],
        date: at,
      });
      expect(res.body.results[0]).toMatchObject({
        status: 'conflict',
        code: 'OUTSIDE_BUSINESS_HOURS',
        details: { reason: 'BUSINESS_CLOSED_DAY', hours: [] },
      });
    });

    it('una profesional con su propio almuerzo no es agendable en él por la app: SLOT_UNAVAILABLE PROFESSIONAL_OFF_SCHEDULE', async () => {
      const res = await appBook(ownerToken, `${monday(7)}T12:30:00`, martaId);
      expect(brief(res)).toEqual([
        409,
        'SLOT_UNAVAILABLE',
        { reason: 'PROFESSIONAL_OFF_SCHEDULE', hours: FRANJAS },
      ]);
    });

    it('/sync/push: crear y mover al almuerzo se aplican sin conflicto', async () => {
      const id = randomUUID();
      const created = await push('appointment.create', id, {
        client_id: clientId,
        professional_id: lauraId,
        service_ids: [serviceId],
        date: `${monday(8)}T12:30:00`,
      });
      expect(created.status).toBe(200);
      expect(created.body.results[0]).toMatchObject({
        status: 'applied',
        entity_id: id,
      });
      const [row] = await ds.query(
        'SELECT sync_conflict, needs_reschedule FROM appointments WHERE id = $1',
        [id],
      );
      expect(row).toEqual({ sync_conflict: null, needs_reschedule: false });

      const moved = await push('appointment.update', id, {
        date: `${monday(9)}T12:00:00`,
      });
      expect(moved.body.results[0]).toMatchObject({ status: 'applied' });
      const [after] = await ds.query(
        'SELECT sync_conflict FROM appointments WHERE id = $1',
        [id],
      );
      expect(after.sync_conflict).toBeNull();
    });

    it('PATCH /appointments/:id: mover una cita del link público al almuerzo se acepta (la app manda)', async () => {
      const web = await webBook(`${monday(10)}T09:00:00`);
      expect(web.status).toBe(201);
      const [{ id }] = await ds.query(
        `SELECT id FROM appointments
          WHERE professional_id = $1 AND source = 'WEB' AND date = $2`,
        [lauraId, `${monday(10)}T09:00:00-05:00`],
      );
      const moved = await http
        .patch(`/api/appointments/${id}`)
        .set(auth(ownerToken))
        .send({ date: `${monday(10)}T12:30:00` });
      expect(moved.status).toBe(200);
      const after = await http
        .patch(`/api/appointments/${id}`)
        .set(auth(ownerToken))
        .send({ date: `${monday(10)}T19:00:00` });
      expect(brief(after)).toEqual([
        409,
        'OUTSIDE_BUSINESS_HOURS',
        { reason: 'OUTSIDE_OPENING_HOURS', hours: TRAMO },
      ]);
    });

    it('horas libres: la app incluye las 12:30 (y las 11:30); el link público no', async () => {
      const day = monday(11);
      const appSlots = await http
        .get(
          `/api/appointments/available-slots?professional_id=${lauraId}` +
            `&date=${day}&service_ids=${serviceId}&step=30`,
        )
        .set(auth(employeeToken));
      expect(appSlots.status).toBe(200);
      const at = (hhmm: string) => `${day}T${hhmm}:00.000-05:00`;
      expect(appSlots.body).toEqual(
        expect.arrayContaining([
          at('11:30'),
          at('12:00'),
          at('12:30'),
          at('13:30'),
        ]),
      );
      expect(appSlots.body[0]).toBe(at('08:00'));
      expect(appSlots.body[appSlots.body.length - 1]).toBe(at('18:00'));
      expect(appSlots.body).toHaveLength(21); // 08:00 … 18:00 cada 30 min

      const web = await http.get(
        `/api/public/businesses/${slug}/available-slots?date=${day}` +
          `&service_ids=${serviceId}&professional_id=${lauraId}&step=30`,
      );
      expect(web.status).toBe(200);
      expect(web.body.slots).not.toContain(at('12:30'));
      expect(web.body.slots).not.toContain(at('11:30'));
      expect(web.body.slots).toContain(at('11:00'));
      expect(web.body.slots).toContain(at('14:00'));
      expect(web.body.slots).toHaveLength(7 + 9); // 08:00–11:00 y 14:00–18:00
    });
  },
);
