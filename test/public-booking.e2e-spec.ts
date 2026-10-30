/**
 * Tarea 9.01 (D-17): agenda pública por link. Escribe: solo contra una copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`).
 *
 * Dos negocios nuevos por la API: A (Bogotá) con la dueña que atiende y una
 * empleada; B (Caracas) solo con su dueño. Horarios lunes 09:00-12:00.
 * El throttle de crear se desactiva salvo en su propio test.
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
/** Lunes lejano (antes de la base 2100 de los demás specs). */
const MONDAY = '2031-03-03';

interface Business {
  slug: string;
  token: string;
  ownerId: string;
  serviceId: string;
  hiddenServiceId: string;
  offset: string;
}

describeWritable('Agenda pública 9.01 (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  const run = randomUUID().slice(0, 8);
  let a: Business;
  let b: Business;
  let employeeId: string;
  let throttle: jest.SpyInstance;
  let phoneSeq = 0;

  const newPhone = () =>
    `3${(Date.now() % 1e8).toString().padStart(8, '0')}${phoneSeq++ % 10}`;

  async function openBusiness(
    n: number,
    zone: string,
    offset: string,
  ): Promise<Business> {
    const reg = await http.post('/api/auth/register/owner').send({
      name: 'Dueña',
      lastname: 'Salón',
      email: `pub-${n}-${run}@example.com`,
      phone: `3${(Date.now() + n).toString().slice(-9)}`,
      password: 'Secreta1!',
      timezone: zone,
      business_name: `Salón ${n} ${run}`,
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token;
    const ownerId = reg.body.user.id;
    const as = (req: any) => req.set(auth(token));
    const category = await as(http.post('/api/categories')).send({
      name: `Cejas ${run}`,
    });
    const service = await as(http.post('/api/services')).send({
      name: `Diseño de cejas ${run}`,
      price: 30000,
      duration: 60,
      categoryId: category.body.id,
      onlineBooking: true,
    });
    const hidden = await as(http.post('/api/services')).send({
      name: `Solo en local ${run}`,
      price: 10000,
      duration: 30,
      categoryId: category.body.id,
      onlineBooking: false,
    });
    expect([service.status, hidden.status]).toEqual([201, 201]);
    // La dueña atiende: tiene horario propio (lunes 09-12).
    const schedule = await as(http.post('/api/schedules')).send({
      user_id: ownerId,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '12:00',
      is_available: true,
    });
    expect(schedule.status).toBe(201);
    const settings = await as(http.get('/api/settings'));
    return {
      slug: settings.body.slug,
      token,
      ownerId,
      serviceId: service.body.id,
      hiddenServiceId: hidden.body.id,
      offset,
    };
  }

  const base = (biz: Business) => `/api/public/businesses/${biz.slug}`;
  const slotsOf = (biz: Business, extra = '') =>
    http.get(
      `${base(biz)}/available-slots?date=${MONDAY}&service_ids=${biz.serviceId}&step=60${extra}`,
    );
  const book = (biz: Business, body: Record<string, unknown>) =>
    http.post(`${base(biz)}/bookings`).send({
      service_ids: [biz.serviceId],
      client: { name: 'Ana', lastname: 'Cliente', phone: newPhone() },
      ...body,
    });

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
    jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
    a = await openBusiness(1, 'America/Bogota', '-05:00');
    b = await openBusiness(2, 'America/Caracas', '-04:00');

    // Empleada de A: verificada, activa, con el servicio y horario lunes 09-12.
    const emp = await http
      .post('/api/auth/register/employee')
      .set(auth(a.token))
      .send({
        name: 'Laura',
        lastname: 'Empleada',
        email: `pub-emp-${run}@example.com`,
        phone: `3${(Date.now() + 7).toString().slice(-9)}`,
        password: 'Secreta1!',
      });
    expect(emp.status).toBe(201);
    employeeId = emp.body.user.id;
    await ds.query(
      `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
      [employeeId],
    );
    const assign = await http
      .post(`/api/users/${employeeId}/services/batch`)
      .set(auth(a.token))
      .send([{ serviceId: a.serviceId }]);
    expect(assign.status).toBe(201);
    const schedule = await http.post('/api/schedules').set(auth(a.token)).send({
      user_id: employeeId,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '12:00',
      is_available: true,
    });
    expect(schedule.status).toBe(201);

    throttle = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await close();
  });

  it('datos del negocio: nombre, zona, horario y si acepta reservas; nada interno; slug inexistente 404', async () => {
    const res = await http.get(base(a));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'accepting_bookings',
      'has_online_services',
      'name',
      'opening_hours',
      'slug',
      'timezone',
    ]);
    expect(res.body).toMatchObject({
      name: `Salón 1 ${run}`,
      timezone: 'America/Bogota',
      accepting_bookings: true,
      has_online_services: true,
    });
    const missing = await http.get('/api/public/businesses/no-existe-xyz');
    expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('7.04-9: un servicio nace sin reserva en línea; sin ninguno, has_online_services = false', async () => {
    const reg = await http.post('/api/auth/register/owner').send({
      name: 'Sin',
      lastname: 'Servicios',
      email: `pub-3-${run}@example.com`,
      phone: `3${(Date.now() + 3).toString().slice(-9)}`,
      password: 'Secreta1!',
      business_name: `Salón 3 ${run}`,
    });
    expect(reg.status).toBe(201);
    const as = (req: any) => req.set(auth(reg.body.token));
    const category = await as(http.post('/api/categories')).send({
      name: `Uñas ${run}`,
    });
    const service = await as(http.post('/api/services')).send({
      name: `Manicure ${run}`,
      price: 20000,
      duration: 45,
      categoryId: category.body.id,
    });
    expect(service.status).toBe(201);
    expect(service.body.onlineBooking).toBe(false);
    const { slug } = (await as(http.get('/api/settings'))).body;
    const info = await http.get(`/api/public/businesses/${slug}`);
    expect(info.body.has_online_services).toBe(false);
    const services = await http.get(`/api/public/businesses/${slug}/services`);
    expect(services.body).toEqual([]);
  });

  it('servicios: solo los activos con reserva en línea, por categoría', async () => {
    const res = await http.get(`${base(a)}/services`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        category: `Cejas ${run}`,
        services: [
          {
            id: a.serviceId,
            name: `Diseño de cejas ${run}`,
            description: null,
            duration: 60,
            price: 30000,
            color: expect.any(String),
          },
        ],
      },
    ]);
  });

  it('profesionales: los que hacen todos los servicios; solo id, nombre y foto', async () => {
    const res = await http.get(
      `${base(a)}/professionals?service_ids=${a.serviceId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => Object.keys(p).sort())).toEqual([
      ['id', 'image', 'name'],
      ['id', 'image', 'name'],
    ]);
    expect(res.body.map((p: any) => p.id).sort()).toEqual(
      [a.ownerId, employeeId].sort(),
    );
    // Servicio sin reserva en línea u otro negocio: 404.
    const hidden = await http.get(
      `${base(a)}/professionals?service_ids=${a.hiddenServiceId}`,
    );
    expect(hidden.status).toBe(404);
    const foreign = await http.get(
      `${base(a)}/professionals?service_ids=${b.serviceId}`,
    );
    expect(foreign.status).toBe(404);
  });

  it('horas libres en la zona de cada negocio; con "cualquiera" = unión', async () => {
    const resA = await slotsOf(a);
    expect(resA.status).toBe(200);
    expect(resA.body).toMatchObject({
      timezone: 'America/Bogota',
      duration_minutes: 60,
    });
    expect(resA.body.slots).toEqual([
      `${MONDAY}T09:00:00.000-05:00`,
      `${MONDAY}T10:00:00.000-05:00`,
      `${MONDAY}T11:00:00.000-05:00`,
    ]);
    const resB = await slotsOf(b);
    expect(resB.body.slots[0]).toBe(`${MONDAY}T09:00:00.000-04:00`);
    // Profesional de otro negocio: 404.
    const foreign = await slotsOf(a, `&professional_id=${b.ownerId}`);
    expect(foreign.status).toBe(404);
  });

  it('reserva con "cualquiera": PENDING, origen WEB, cliente creado, aviso interno; sin ids en la respuesta', async () => {
    const phone = '300 555 0101';
    const res = await book(a, {
      start: `${MONDAY}T09:00:00`,
      client: {
        name: 'Ana',
        lastname: 'Web',
        phone,
        email: 'ana.web@example.com',
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      timezone: 'America/Bogota',
      start: `${MONDAY}T09:00:00.000-05:00`,
      end: `${MONDAY}T10:00:00.000-05:00`,
      total_price: 30000,
    });
    expect(JSON.stringify(res.body)).not.toContain(a.ownerId);
    const [row] = await ds.query(
      `SELECT a.status, a.source, a.professional_id, c.name, c.phone, c.email
         FROM appointments a JOIN clients c ON c.id = a."clientId"
        WHERE a.owner_id = $1 AND a.source = 'WEB' ORDER BY a.created_at DESC LIMIT 1`,
      [a.ownerId],
    );
    expect(row).toMatchObject({
      status: 'PENDING',
      source: 'WEB',
      name: 'Ana',
      phone: '3005550101',
      email: 'ana.web@example.com',
    });
    // Determinista: ambas sin citas ese día → por nombre ("Dueña" < "Laura").
    expect(row.professional_id).toBe(a.ownerId);
    const notes = await ds.query(
      `SELECT receiver_id FROM notifications
        WHERE metadata->>'kind' = 'ONLINE_BOOKING' AND receiver_id = $1`,
      [a.ownerId],
    );
    expect(notes.length).toBeGreaterThan(0);

    // El mismo teléfono con otro formato: mismo cliente, sin cambiar sus datos.
    const again = await book(a, {
      start: `${MONDAY}T11:00:00`,
      client: { name: 'Otro', phone: '(300) 555-0101' },
    });
    expect(again.status).toBe(201);
    const clients = await ds.query(
      `SELECT name FROM clients WHERE owner_id = $1 AND phone = '3005550101'`,
      [a.ownerId],
    );
    expect(clients).toEqual([{ name: 'Ana' }]);
  });

  it('choque con una cita de la app: con la dueña 409; con "cualquiera" toma a la empleada', async () => {
    // Cita de la app a las 10:00 con la dueña.
    const client = await http
      .post('/api/clients')
      .set(auth(a.token))
      .send({ name: 'App', lastname: 'Cliente', phone: newPhone() });
    const fromApp = await http
      .post('/api/appointments')
      .set(auth(a.token))
      .send({
        client_id: client.body.id,
        professional_id: a.ownerId,
        service_ids: [a.serviceId],
        date: `${MONDAY}T10:00:00`,
      });
    expect(fromApp.status).toBe(201);

    const clash = await book(a, {
      start: `${MONDAY}T10:00:00`,
      professional_id: a.ownerId,
    });
    expect([clash.status, clash.body.code]).toEqual([409, 'SLOT_UNAVAILABLE']);
    const any = await book(a, { start: `${MONDAY}T10:00:00` });
    expect(any.status).toBe(201);
    expect(any.body.professional.name).toBe('Laura');
    // Las 10:00 ya no están libres para nadie.
    const slots = await slotsOf(a);
    expect(slots.body.slots).not.toContain(`${MONDAY}T10:00:00.000-05:00`);
  });

  it(`límite: 3 reservas PENDING a futuro por teléfono y negocio`, async () => {
    const phone = newPhone();
    const starts = ['T09:00:00', 'T10:00:00', 'T11:00:00'].map(
      (t) => `2031-03-10${t}`,
    );
    for (const start of starts) {
      const res = await book(a, { start, client: { name: 'Eva', phone } });
      expect(res.status).toBe(201);
    }
    const fourth = await book(a, {
      start: '2031-03-17T09:00:00',
      client: { name: 'Eva', phone },
    });
    expect([fourth.status, fourth.body.code]).toEqual([
      409,
      'BOOKING_LIMIT_REACHED',
    ]);
    // En otro negocio, el mismo teléfono sí puede.
    const other = await book(b, {
      start: '2031-03-17T09:00:00',
      client: { name: 'Eva', phone },
    });
    expect(other.status).toBe(201);
  });

  it('trial agotado: horas libres y reservas → 409 ONLINE_BOOKING_UNAVAILABLE; los datos dicen accepting_bookings=false', async () => {
    await resetTrialQuota(ds, b.ownerId, { used: 20, limit: 20 });
    const info = await http.get(base(b));
    expect(info.body.accepting_bookings).toBe(false);
    const slots = await slotsOf(b);
    expect([slots.status, slots.body.code]).toEqual([
      409,
      'ONLINE_BOOKING_UNAVAILABLE',
    ]);
    const res = await book(b, { start: `${MONDAY}T11:00:00` });
    expect([res.status, res.body.code]).toEqual([
      409,
      'ONLINE_BOOKING_UNAVAILABLE',
    ]);
    expect(res.body.message).toBe(
      'Este negocio no está recibiendo reservas en línea en este momento',
    );
  });

  it('validación: honeypot, teléfono inválido, hora pasada y campos de más → 400', async () => {
    const honeypot = await book(a, {
      start: '2031-03-24T09:00:00',
      website: 'http://spam',
    });
    expect(honeypot.status).toBe(400);
    const badPhone = await book(a, {
      start: '2031-03-24T09:00:00',
      client: { name: 'Ana', phone: '12ab' },
    });
    expect([badPhone.status, badPhone.body.code]).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
    const past = await book(a, { start: '2020-01-06T09:00:00' });
    expect([past.status, past.body.code]).toEqual([400, 'APPOINTMENT_IN_PAST']);
    const extra = await book(a, {
      start: '2031-03-24T09:00:00',
      owner_id: b.ownerId,
    });
    expect(extra.status).toBe(400);
  });

  it('throttle: más de 5 reservas por minuto desde la misma IP → 429', async () => {
    throttle.mockRestore();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await book(a, { start: '2020-01-06T09:00:00' })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
