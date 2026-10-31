/**
 * 2026-10-31: (1) una empleada solo lee SU agenda (servicios asignados y
 * horarios); la de otra → 404. (2) Un servicio desactivado (`isActive=false`
 * por `PATCH /services/:id`) no se agenda ni sale en horas libres, en
 * `/auth/me/services` ni en la web pública; las citas que ya lo tienen no
 * cambian. Escribe: solo contra una copia.
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
const MONDAY = '2031-06-02';

describeWritable(
  'Agenda propia y servicios desactivados (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    let ownerToken: string;
    let ownerId: string;
    let slug: string;
    let serviceId: string;
    let clientId: string;
    const team: Record<
      string,
      { id: string; token: string; scheduleId: string }
    > = {};

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Agenda',
        email: `agenda-${run}@example.com`,
        phone: `3${Date.now().toString().slice(-9)}`,
        password: 'Secreta1!',
        business_name: `Agenda ${run}`,
      });
      ownerToken = reg.body.token;
      ownerId = reg.body.user.id;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const as = (req: any) => req.set(auth(ownerToken));
      slug = (await as(http.get('/api/settings'))).body.slug;
      const category = await as(http.post('/api/categories')).send({
        name: `Cat ${run}`,
      });
      serviceId = (
        await as(http.post('/api/services')).send({
          name: `Cejas ${run}`,
          price: 30000,
          duration: 60,
          categoryId: category.body.id,
          onlineBooking: true,
        })
      ).body.id;
      clientId = (
        await as(http.post('/api/clients')).send({
          name: 'Ana',
          lastname: 'Cliente',
          phone: `31${Date.now().toString().slice(-8)}`,
        })
      ).body.id;
      for (const [i, name] of ['Ana', 'Laura'].entries()) {
        const email = `agenda-${name}-${run}@example.com`;
        const emp = await as(http.post('/api/auth/register/employee')).send({
          name,
          lastname: 'Equipo',
          email,
          phone: `3${(Date.now() + i + 1).toString().slice(-9)}`,
          password: 'Secreta1!',
        });
        const id = emp.body.user.id;
        await ds.query(
          `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
          [id],
        );
        await as(http.post(`/api/users/${id}/services/batch`)).send([
          { serviceId },
        ]);
        const schedule = await as(http.post('/api/schedules')).send({
          user_id: id,
          day_of_week: 1,
          start_time: '09:00',
          end_time: '18:00',
          is_available: true,
        });
        team[name] = {
          id,
          token: signToken({ id, name, email, owner: { id: ownerId } }, [
            'Employee',
          ]),
          scheduleId: schedule.body.id,
        };
      }
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('servicios asignados: cada empleada lee los suyos; los de la otra → 404; el Owner, todos', async () => {
      const { Ana, Laura } = team;
      const own = await http
        .get(`/api/users/${Ana.id}/services`)
        .set(auth(Ana.token));
      expect(own.status).toBe(200);
      const other = await http
        .get(`/api/users/${Laura.id}/services`)
        .set(auth(Ana.token));
      expect([other.status, other.body.code]).toEqual([404, 'NOT_FOUND']);
      const owner = await http
        .get(`/api/users/${Laura.id}/services`)
        .set(auth(ownerToken));
      expect(owner.status).toBe(200);
    });

    it('horarios: por profesional y por id, solo los suyos; los de la otra → 404', async () => {
      const { Ana, Laura } = team;
      expect(
        (await http.get(`/api/schedules/user/${Ana.id}`).set(auth(Ana.token)))
          .status,
      ).toBe(200);
      const byUser = await http
        .get(`/api/schedules/user/${Laura.id}`)
        .set(auth(Ana.token));
      expect([byUser.status, byUser.body.code]).toEqual([404, 'NOT_FOUND']);
      expect(
        (
          await http
            .get(`/api/schedules/${Ana.scheduleId}`)
            .set(auth(Ana.token))
        ).status,
      ).toBe(200);
      const byId = await http
        .get(`/api/schedules/${Laura.scheduleId}`)
        .set(auth(Ana.token));
      expect([byId.status, byId.body.code]).toEqual([404, 'NOT_FOUND']);
      // Escribir horarios o asignaciones sigue siendo solo del Owner.
      const write = await http
        .post(`/api/users/${Ana.id}/services/batch`)
        .set(auth(Ana.token))
        .send([{ serviceId }]);
      expect(write.status).toBe(403);
      expect(
        (
          await http
            .get(`/api/schedules/user/${Laura.id}`)
            .set(auth(ownerToken))
        ).status,
      ).toBe(200);
    });

    it('servicio desactivado: no se agenda ni sale en horas libres, en /auth/me/services ni en la web; las citas que ya lo tienen siguen', async () => {
      const { Ana } = team;
      const as = (req: any) => req.set(auth(ownerToken));
      const existing = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: Ana.id,
        service_ids: [serviceId],
        date: `${MONDAY}T10:00:00`,
      });
      expect(existing.status).toBe(201);

      const off = await as(http.patch(`/api/services/${serviceId}`)).send({
        isActive: false,
      });
      expect([off.status, off.body.isActive]).toEqual([200, false]);

      const book = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: Ana.id,
        service_ids: [serviceId],
        date: `${MONDAY}T12:00:00`,
      });
      expect([book.status, book.body.code]).toEqual([409, 'SERVICE_INACTIVE']);
      const slots = await as(
        http.get(
          `/api/appointments/available-slots?professional_id=${Ana.id}` +
            `&date=${MONDAY}&service_ids=${serviceId}`,
        ),
      );
      expect([slots.status, slots.body.code]).toEqual([
        409,
        'SERVICE_INACTIVE',
      ]);
      const mine = await http.get('/api/auth/me/services').set(auth(Ana.token));
      expect(mine.body).toEqual([]);
      const web = await http.get(`/api/public/businesses/${slug}/services`);
      expect(web.body).toEqual([]);

      // La cita que ya lo tenía no cambia y se puede mover y editar.
      const moved = await as(
        http.patch(`/api/appointments/${existing.body.id}`),
      ).send({
        date: `${MONDAY}T14:00:00`,
        service_ids: [serviceId],
      });
      expect(moved.status).toBe(200);
      expect(moved.body.services.map((s: any) => s.id)).toEqual([serviceId]);

      // Reactivarlo lo devuelve a la agenda.
      await as(http.patch(`/api/services/${serviceId}`)).send({
        isActive: true,
      });
      const again = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: Ana.id,
        service_ids: [serviceId],
        date: `${MONDAY}T12:00:00`,
      });
      expect(again.status).toBe(201);
    });
  },
);
