/**
 * 13.04 (D-25): (a) `SLOT_UNAVAILABLE` con `details.reason` (y
 * `OUTSIDE_BUSINESS_HOURS` con el suyo), también en `/sync/push`; (b) el
 * horario partido del empleado: `GET /auth/employees` devuelve todas las
 * franjas disponibles (`schedule_slots`), el alta y la edición aceptan varias
 * por día y el formato anterior no borra la franja de la tarde; (c) sin
 * `notification_token` en la lista de empleados. Escribe: solo contra una copia.
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
import {
  assertWritableDatabase,
  describeWritable,
  firstFreeWeek,
  futureMonday,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const MORNING = { start: '09:00', end: '13:00' };
const AFTERNOON = { start: '14:00', end: '18:00' };

describeWritable(
  'Horario partido del empleado y motivo del hueco (13.04, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let ownerToken: string;
    let ownerId: string;
    let employeeId: string;
    let serviceId: string;
    let clientId: string;
    let monday: string; // YYYY-MM-DD
    let tuesday: string;
    const run = randomUUID().slice(0, 8);

    const as = (req: any) => req.set(auth(ownerToken));
    const book = (at: string) =>
      as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: employeeId,
        service_ids: [serviceId],
        date: at,
      });
    const listed = async () => {
      const res = await as(http.get('/api/auth/employees'));
      expect(res.status).toBe(200);
      return res.body.find((u: any) => u.id === employeeId);
    };
    const rows = () =>
      ds.query(
        `SELECT id, day_of_week, start_time::text AS start, end_time::text AS "end", is_available
           FROM schedules WHERE "userId" = $1
          ORDER BY day_of_week, start_time`,
        [employeeId],
      );

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Franjas',
        email: `slots-${run}@example.com`,
        phone: `3${Date.now().toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      expect(reg.status).toBe(201);
      ownerToken = reg.body.token;
      ownerId = reg.body.user.id;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
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
          lastname: 'Franjas',
          phone: `31${Date.now().toString().slice(-8)}`,
        })
      ).body.id;
      const week = futureMonday(await firstFreeWeek(ds));
      monday = new Date(week).toISOString().slice(0, 10);
      tuesday = new Date(week + 24 * 3_600_000).toISOString().slice(0, 10);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('alta con dos franjas el lunes (formato nuevo) y el martes en el formato anterior', async () => {
      const res = await as(http.post('/api/auth/register/employee')).send({
        name: 'Laura',
        lastname: 'Partida',
        email: `slots-emp-${run}@example.com`,
        phone: `3${(Date.now() + 7).toString().slice(-9)}`,
        password: 'Secreta1!',
        services: [{ serviceId }],
        schedule: {
          monday: [AFTERNOON, MORNING],
          tuesday: { start: '10:00', end: '16:00' },
        },
      });
      expect(res.status).toBe(201);
      employeeId = res.body.user.id;
      expect(res.body.user.schedule_slots).toEqual({
        monday: [MORNING, AFTERNOON],
        tuesday: [{ start: '10:00', end: '16:00' }],
      });
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true,
                notification_token = 'push-secreto' WHERE id = $1`,
        [employeeId],
      );
      expect(await rows()).toHaveLength(3);
    });

    it('GET /auth/employees y /auth/employee/:id: todas las franjas disponibles, la no disponible no sale, sin notification_token', async () => {
      // Fila de no disponibilidad (la crea `/schedules`): no es una franja.
      await ds.query(
        `INSERT INTO schedules ("userId", day_of_week, start_time, end_time, is_available)
         VALUES ($1, 3, '10:00', '12:00', false)`,
        [employeeId],
      );
      const employee = await listed();
      expect(employee.schedule_slots).toEqual({
        monday: [MORNING, AFTERNOON],
        tuesday: [{ start: '10:00', end: '16:00' }],
      });
      // Formato anterior (la app hasta 13.05): la primera franja de cada día.
      expect(employee.schedule).toEqual({
        monday: MORNING,
        tuesday: { start: '10:00', end: '16:00' },
      });
      const all = (await as(http.get('/api/auth/employees'))).body;
      for (const user of all) {
        expect(user).not.toHaveProperty('notification_token');
      }
      const one = await as(http.get(`/api/auth/employee/${employeeId}`));
      expect(one.body.schedule_slots).toEqual(employee.schedule_slots);
      expect(one.body).not.toHaveProperty('notification_token');
    });

    it('PATCH con el formato anterior (lo que reenvía la app vieja al cambiar el nombre) conserva la franja de la tarde y los ids', async () => {
      const before = await rows();
      const { schedule } = await listed();
      const res = await as(http.patch(`/api/auth/employee/${employeeId}`)).send(
        { name: 'Laura María', schedule },
      );
      expect(res.status).toBe(200);
      expect(res.body.schedule_slots.monday).toEqual([MORNING, AFTERNOON]);
      expect(await rows()).toEqual(before); // ni borra ni recrea filas
    });

    it('PATCH con el formato anterior y otra hora: cambia esa franja y conserva la otra', async () => {
      const res = await as(http.patch(`/api/auth/employee/${employeeId}`)).send(
        {
          schedule: {
            monday: { start: '08:00', end: '12:00' },
            tuesday: { start: '10:00', end: '16:00' },
          },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.schedule_slots.monday).toEqual([
        { start: '08:00', end: '12:00' },
        AFTERNOON,
      ]);
    });

    it('PATCH con el formato nuevo: el día queda con esas franjas; un día que no viene queda libre; la no disponible sigue', async () => {
      const res = await as(http.patch(`/api/auth/employee/${employeeId}`)).send(
        {
          schedule: {
            monday: [MORNING, AFTERNOON, { start: '19:00', end: '21:00' }],
          },
        },
      );
      expect(res.status).toBe(200);
      expect(res.body.schedule_slots).toEqual({
        monday: [MORNING, AFTERNOON, { start: '19:00', end: '21:00' }],
      });
      const left = await rows();
      expect(left.filter((r: any) => !r.is_available)).toHaveLength(1);
      // Deja el lunes partido y el martes para los casos de hueco.
      const reset = await as(
        http.patch(`/api/auth/employee/${employeeId}`),
      ).send({
        schedule: {
          monday: [MORNING, AFTERNOON],
          tuesday: [{ start: '09:00', end: '18:00' }],
        },
      });
      expect(reset.body.schedule_slots.monday).toEqual([MORNING, AFTERNOON]);
    });

    it('franjas que se solapan, fin antes del inicio u hora mal escrita: 400 VALIDATION_ERROR y no cambia nada', async () => {
      const before = await rows();
      for (const schedule of [
        { monday: [MORNING, { start: '12:00', end: '15:00' }] },
        { monday: [{ start: '13:00', end: '09:00' }] },
        { monday: { start: '9:00', end: '13:00' } },
        { lunes: [MORNING] },
      ]) {
        const res = await as(
          http.patch(`/api/auth/employee/${employeeId}`),
        ).send({ schedule });
        expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_ERROR']);
      }
      const overlap = await as(
        http.patch(`/api/auth/employee/${employeeId}`),
      ).send({
        schedule: { monday: [MORNING, { start: '12:00', end: '15:00' }] },
      });
      expect(overlap.body.message).toMatch(/se solapan/);
      expect(await rows()).toEqual(before);
    });

    it('el horario partido se respeta al agendar; cada SLOT_UNAVAILABLE dice su motivo', async () => {
      // Entre franjas (13:30): fuera del horario del profesional.
      const between = await book(`${monday}T13:30:00`);
      expect(between.status).toBe(409);
      expect(between.body).toEqual({
        statusCode: 409,
        code: 'SLOT_UNAVAILABLE',
        message: 'Horario no disponible',
        details: {
          reason: 'PROFESSIONAL_OFF_SCHEDULE',
          hours: [MORNING, AFTERNOON],
        },
      });
      // La franja de la tarde sí agenda.
      expect((await book(`${monday}T14:00:00`)).status).toBe(201);
      const morning = await book(`${monday}T10:00:00`);
      expect(morning.status).toBe(201);

      const overlap = await book(`${monday}T10:30:00`);
      expect([overlap.status, overlap.body.code, overlap.body.details]).toEqual(
        [409, 'SLOT_UNAVAILABLE', { reason: 'APPOINTMENT_OVERLAP' }],
      );

      const block = await as(http.post('/api/time-blocks')).send({
        user_id: employeeId,
        start_datetime: `${monday}T16:00:00`,
        end_datetime: `${monday}T17:00:00`,
      });
      expect(block.status).toBe(201);
      const blocked = await book(`${monday}T16:00:00`);
      expect([blocked.status, blocked.body.details]).toEqual([
        409,
        { reason: 'TIME_BLOCK' },
      ]);

      // Un bloqueo encima de la cita de las 10:00.
      const onAppointment = await as(http.post('/api/time-blocks')).send({
        user_id: employeeId,
        start_datetime: `${monday}T10:00:00`,
        end_datetime: `${monday}T10:30:00`,
      });
      expect([
        onAppointment.status,
        onAppointment.body.code,
        onAppointment.body.details,
      ]).toEqual([409, 'SLOT_UNAVAILABLE', { reason: 'APPOINTMENT_OVERLAP' }]);
    });

    it('/sync/push: la cita en conflicto queda guardada y el resultado lleva el motivo', async () => {
      const id = randomUUID();
      const res = await as(http.post('/api/sync/push')).send({
        device_id: 'tablet',
        mutations: [
          {
            mutation_id: randomUUID(),
            type: 'appointment.create',
            entity_id: id,
            client_time: new Date().toISOString(),
            payload: {
              client_id: clientId,
              professional_id: employeeId,
              service_ids: [serviceId],
              date: `${monday}T10:00:00`,
            },
          },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.results[0]).toMatchObject({
        status: 'conflict',
        code: 'SLOT_UNAVAILABLE',
        saved: true,
        entity_id: id,
        details: { reason: 'APPOINTMENT_OVERLAP' },
      });
    });

    it('OUTSIDE_BUSINESS_HOURS: fuera de las franjas del negocio o día cerrado, con las horas del día', async () => {
      const patch = await as(http.patch('/api/settings')).send({
        opening_hours: [
          { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
        ],
      });
      expect(patch.status).toBe(200);
      const late = await book(`${monday}T15:00:00`);
      expect([late.status, late.body.code, late.body.details]).toEqual([
        409,
        'OUTSIDE_BUSINESS_HOURS',
        {
          reason: 'OUTSIDE_OPENING_HOURS',
          hours: [{ start: '09:00', end: '12:00' }],
        },
      ]);
      const closed = await book(`${tuesday}T10:00:00`);
      expect([closed.status, closed.body.details]).toEqual([
        409,
        { reason: 'BUSINESS_CLOSED_DAY', hours: [] },
      ]);
      await as(http.patch('/api/settings')).send({ opening_hours: null });
    });
  },
);
