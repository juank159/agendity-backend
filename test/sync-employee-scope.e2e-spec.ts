/**
 * Bajada de la empleada (`GET /sync/changes`): recibe lo mismo que la API le
 * deja leer, nada más (fuga detectada por FD, 2026-11-01). Un caso por tabla
 * revisada. Escribe: solo contra una copia.
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
const MONDAY = '2031-07-07';

interface Change {
  entity: string;
  id: string;
  op: string;
  data: any;
}

describeWritable(
  'Bajada de la empleada: solo lo suyo (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    let ownerToken: string;
    let ownerId: string;
    let serviceId: string;
    let clientId: string;
    const team: Record<
      string,
      { id: string; token: string; scheduleId: string; assignmentId: string }
    > = {};
    let n = 0;
    const phone = () => `3${(Date.now() + ++n).toString().slice(-9)}`;

    async function pull(token: string, cursor = '0') {
      const changes: Change[] = [];
      let next = cursor;
      for (let i = 0; i < 100; i++) {
        const res = await http
          .get(`/api/sync/changes?cursor=${next}&limit=200`)
          .set(auth(token));
        expect(res.status).toBe(200);
        changes.push(...res.body.changes);
        next = res.body.cursor;
        if (!res.body.has_more) break;
      }
      return { changes, cursor: next };
    }
    const of = (changes: Change[], entity: string) =>
      changes.filter((c) => c.entity === entity);

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Alcance',
        email: `scope-${run}@example.com`,
        phone: phone(),
        password: 'Secreta1!',
      });
      ownerToken = reg.body.token;
      ownerId = reg.body.user.id;
      await resetTrialQuota(ds, ownerId, { limit: 1000 });
      const as = (req: any) => req.set(auth(ownerToken));
      const category = await as(http.post('/api/categories')).send({
        name: `Cat ${run}`,
      });
      serviceId = (
        await as(http.post('/api/services')).send({
          name: `Cejas ${run}`,
          price: 30000,
          duration: 60,
          categoryId: category.body.id,
        })
      ).body.id;
      clientId = (
        await as(http.post('/api/clients')).send({
          name: 'Ana',
          lastname: 'Cliente',
          phone: phone(),
        })
      ).body.id;
      await as(http.post('/api/custom-payment-methods')).send({
        name: `Nequi ${run}`,
      });
      for (const name of ['Ana', 'Laura']) {
        const email = `scope-${name}-${run}@example.com`;
        const emp = await as(http.post('/api/auth/register/employee')).send({
          name,
          lastname: 'Equipo',
          email,
          phone: phone(),
          password: 'Secreta1!',
          commission_percentage: 35,
        });
        const id = emp.body.user.id;
        await ds.query(
          `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
          [id],
        );
        const assigned = await as(
          http.post(`/api/users/${id}/services/batch`),
        ).send([{ serviceId, commissionPercentage: 40 }]);
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
          assignmentId: assigned.body[0].id,
        };
      }
      // Una cita y un bloqueo por empleada, una reseña y un pago del negocio.
      for (const name of ['Ana', 'Laura']) {
        const appt = await as(http.post('/api/appointments')).send({
          client_id: clientId,
          professional_id: team[name].id,
          service_ids: [serviceId],
          date: `${MONDAY}T${name === 'Ana' ? '10' : '11'}:00:00`,
        });
        await as(http.post('/api/payments')).send({
          appointment_id: appt.body.id,
          amount: 10000,
          payment_method: 'CASH',
        });
        await as(http.post('/api/time-blocks')).send({
          user_id: team[name].id,
          start_datetime: `${MONDAY}T15:00:00`,
          end_datetime: `${MONDAY}T16:00:00`,
        });
      }
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('users: solo ella misma, con los campos de /auth/me y sin comisión', async () => {
      const { changes } = await pull(team.Ana.token);
      const users = of(changes, 'users');
      expect(users.map((c) => c.id)).toEqual([team.Ana.id]);
      expect(Object.keys(users[0].data).sort()).toEqual([
        'deletedAt',
        'email',
        'id',
        'image',
        'isActive',
        'is_email_verified',
        'lastname',
        'name',
        'phone',
        'roles',
      ]);
      expect(JSON.stringify(changes)).not.toContain(`scope-Laura-${run}`);
    });

    it('user_services: solo sus asignaciones', async () => {
      const { changes } = await pull(team.Ana.token);
      expect(of(changes, 'user_services').map((c) => c.id)).toEqual([
        team.Ana.assignmentId,
      ]);
    });

    it('schedules: solo sus horarios', async () => {
      const { changes } = await pull(team.Ana.token);
      expect(of(changes, 'schedules').map((c) => c.id)).toEqual([
        team.Ana.scheduleId,
      ]);
    });

    it('appointments y time_block: solo los suyos', async () => {
      const { changes } = await pull(team.Ana.token);
      const appts = of(changes, 'appointments');
      expect(appts).toHaveLength(1);
      expect(appts[0].data.professionalId).toBe(team.Ana.id);
      const blocks = of(changes, 'time_block');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].data.user).toBe(team.Ana.id);
    });

    it('payments, custom_payment_methods y reviews: nada (la API no se los da)', async () => {
      const { changes } = await pull(team.Ana.token);
      for (const entity of ['payments', 'custom_payment_methods', 'reviews']) {
        expect([entity, of(changes, entity)]).toEqual([entity, []]);
      }
      // El Owner sí los recibe.
      const owner = await pull(ownerToken);
      expect(of(owner.changes, 'payments')).toHaveLength(2);
      expect(of(owner.changes, 'custom_payment_methods')).toHaveLength(1);
    });

    it('notifications: solo las suyas como receptora', async () => {
      await ds.query(
        `INSERT INTO notifications (receiver_id, receiver_type, type, title, message)
       VALUES ($1, 'USER', 'GENERAL', 'Para Ana', 'x'), ($2, 'USER', 'GENERAL', 'Para Laura', 'y')`,
        [team.Ana.id, team.Laura.id],
      );
      const { changes } = await pull(team.Ana.token);
      expect(of(changes, 'notifications').map((c) => c.data.title)).toEqual([
        'Para Ana',
      ]);
    });

    it('catálogo, clientes y configuración: sí (la API se los deja leer)', async () => {
      const { changes } = await pull(team.Ana.token);
      for (const entity of [
        'business_settings',
        'categories',
        'services',
        'clients',
      ]) {
        expect([entity, of(changes, entity).length > 0]).toEqual([
          entity,
          true,
        ]);
      }
    });

    it('leave_scope y borrados: un horario que pasa a Laura y una asignación que se borra', async () => {
      const start = (await pull(team.Ana.token)).cursor;
      const moved = await http
        .patch(`/api/schedules/${team.Ana.scheduleId}`)
        .set(auth(ownerToken))
        .send({ user_id: team.Laura.id, day_of_week: 2 });
      expect(moved.status).toBe(200);
      // La asignación de Ana pasa a Laura (solo posible por SQL) y otra se borra.
      await ds.query('UPDATE user_services SET user_id = $1 WHERE id = $2', [
        team.Laura.id,
        team.Ana.assignmentId,
      ]);
      const { changes } = await pull(team.Ana.token, start);
      expect(
        changes
          .filter((c) =>
            [team.Ana.scheduleId, team.Ana.assignmentId].includes(c.id),
          )
          .map((c) => [c.entity, c.op])
          .sort(),
      ).toEqual([
        ['schedules', 'leave_scope'],
        ['user_services', 'leave_scope'],
      ]);
      // Laura las recibe como suyas.
      const laura = await pull(team.Laura.token, '0');
      expect(of(laura.changes, 'schedules').map((c) => c.id)).toContain(
        team.Ana.scheduleId,
      );

      // Borrado de un horario suyo: tombstone para ella.
      const own = await http.post('/api/schedules').set(auth(ownerToken)).send({
        user_id: team.Ana.id,
        day_of_week: 3,
        start_time: '09:00',
        end_time: '12:00',
        is_available: true,
      });
      const cursor = (await pull(team.Ana.token)).cursor;
      await http.delete(`/api/schedules/${own.body.id}`).set(auth(ownerToken));
      const after = await pull(team.Ana.token, cursor);
      expect(
        after.changes.filter((c) => c.id === own.body.id).map((c) => c.op),
      ).toEqual(['delete']);
    });
  },
);
