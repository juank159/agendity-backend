/**
 * Tarea 10.01a (D-18): `GET /sync/changes`. Escribe: solo contra una copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`), con dos negocios nuevos.
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
import { assertWritableDatabase, describeWritable } from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const MONDAY = '2031-04-07';

interface Change {
  entity: string;
  id: string;
  version: string;
  op: 'upsert' | 'delete' | 'leave_scope';
  data: any;
}

describeWritable(
  'Sincronización: bajada 10.01a (e2e, escribe en copia)',
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
    let ownerCursor = '0';
    let employeeCursor = '0';

    /** Todas las páginas desde `cursor` (con `limit` pequeño para paginar). */
    async function pull(token: string, cursor: string, limit = 3) {
      const changes: Change[] = [];
      let next = cursor;
      for (let i = 0; i < 200; i++) {
        const res = await http
          .get(`/api/sync/changes?cursor=${next}&limit=${limit}`)
          .set(auth(token));
        expect(res.status).toBe(200);
        changes.push(...res.body.changes);
        next = res.body.cursor;
        if (!res.body.has_more) break;
      }
      return { changes, cursor: next };
    }

    async function register(n: number) {
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Sync',
        email: `sync-${n}-${run}@example.com`,
        phone: `3${(Date.now() + n).toString().slice(-9)}`,
        password: 'Secreta1!',
        business_name: `Sync ${n} ${run}`,
      });
      expect(reg.status).toBe(201);
      return reg.body;
    }

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);

      const a = await register(1);
      ownerToken = a.token;
      ownerId = a.user.id;
      otherToken = (await register(2)).token;
      const as = (req: any) => req.set(auth(ownerToken));

      const category = await as(http.post('/api/categories')).send({
        name: `Cejas ${run}`,
      });
      const service = await as(http.post('/api/services')).send({
        name: `Diseño ${run}`,
        price: 30000,
        duration: 60,
        categoryId: category.body.id,
      });
      serviceId = service.body.id;
      const client = await as(http.post('/api/clients')).send({
        name: 'Ana',
        lastname: 'Sync',
        phone: `31${Date.now().toString().slice(-8)}`,
      });
      clientId = client.body.id;

      const emp = await as(http.post('/api/auth/register/employee')).send({
        name: 'Laura',
        lastname: 'Sync',
        email: `sync-emp-${run}@example.com`,
        phone: `3${(Date.now() + 9).toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      employeeId = emp.body.user.id;
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true,
                commission_percentage = 40 WHERE id = $1`,
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
          email: `sync-emp-${run}@example.com`,
          owner: { id: ownerId },
        },
        ['Employee'],
      );
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      jest.restoreAllMocks();
      await close();
    });

    it('carga inicial paginada: todo el negocio, versiones crecientes y sin repetir; el cursor final no trae nada', async () => {
      const { changes, cursor } = await pull(ownerToken, '0');
      const versions = changes.map((c) => BigInt(c.version));
      expect(versions).toEqual([...versions].sort((x, y) => (x < y ? -1 : 1)));
      expect(new Set(versions.map(String)).size).toBe(versions.length);
      const entities = new Set(changes.map((c) => c.entity));
      for (const name of [
        'business_settings',
        'users',
        'categories',
        'services',
        'user_services',
        'schedules',
        'clients',
      ]) {
        expect(entities).toContain(name);
      }
      const client = changes.find((c) => c.id === clientId);
      expect(client).toMatchObject({ op: 'upsert', data: { name: 'Ana' } });
      // Sin secretos de usuario.
      expect(JSON.stringify(changes)).not.toMatch(/password|verification_code/);
      ownerCursor = cursor;
      const again = await pull(ownerToken, cursor);
      expect(again.changes).toEqual([]);
      expect(again.cursor).toBe(cursor);
      employeeCursor = (await pull(employeeToken, '0')).cursor;
    });

    it('cambios y borrados llegan después del cursor (borrado = tombstone)', async () => {
      const as = (req: any) => req.set(auth(ownerToken));
      await as(http.patch(`/api/clients/${clientId}`)).send({
        name: 'Ana María',
      });
      const temp = await as(http.post('/api/clients')).send({
        name: 'Temporal',
        lastname: 'Borrar',
        phone: `32${Date.now().toString().slice(-8)}`,
      });
      const removed = await as(http.delete(`/api/clients/${temp.body.id}`));
      expect(removed.status).toBe(200);

      const { changes, cursor } = await pull(ownerToken, ownerCursor);
      expect(changes.find((c) => c.id === clientId)).toMatchObject({
        op: 'upsert',
        data: { name: 'Ana María' },
      });
      const ofTemp = changes.filter((c) => c.id === temp.body.id);
      // Creada y borrada: la fila ya no existe, solo queda el tombstone.
      expect(ofTemp.map((c) => c.op)).toEqual(['delete']);
      ownerCursor = cursor;
    });

    it('permisos: el Employee recibe solo sus citas y nada de pagos; si la cita cambia de profesional, leave_scope', async () => {
      const as = (req: any) => req.set(auth(ownerToken));
      const mine = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: employeeId,
        service_ids: [serviceId],
        date: `${MONDAY}T10:00:00`,
      });
      expect(mine.status).toBe(201);
      // La línea lleva su comisión congelada (la app no la adivina).
      expect(mine.body.services[0]).toMatchObject({
        appointment_price: '30000.00',
        appointment_commission_percentage: '40.00',
      });
      const ownerOnly = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: ownerId,
        service_ids: [serviceId],
        date: `${MONDAY}T12:00:00`,
      });
      expect(ownerOnly.status).toBe(201);
      const paid = await as(http.post('/api/payments')).send({
        appointment_id: mine.body.id,
        amount: 10000,
        payment_method: 'CASH',
      });
      expect(paid.status).toBe(201);

      const emp = await pull(employeeToken, employeeCursor);
      const appointmentIds = emp.changes
        .filter((c) => c.entity === 'appointments')
        .map((c) => c.id);
      expect(appointmentIds).toContain(mine.body.id);
      expect(appointmentIds).not.toContain(ownerOnly.body.id);
      expect(emp.changes.some((c) => c.entity === 'payments')).toBe(false);
      const appt = emp.changes.find((c) => c.id === mine.body.id);
      expect(appt.data.services[0]).toMatchObject({
        id: serviceId,
        appointment_commission_percentage: '40.00',
      });
      // Fechas con el offset de la zona de la cita.
      expect(appt.data.date).toBe(`${MONDAY}T10:00:00.000-05:00`);
      employeeCursor = emp.cursor;

      // El Owner sí ve las dos citas y el pago.
      const own = await pull(ownerToken, ownerCursor);
      expect(own.changes.map((c) => c.id)).toEqual(
        expect.arrayContaining([mine.body.id, ownerOnly.body.id, paid.body.id]),
      );
      ownerCursor = own.cursor;

      // Se la pasa a la dueña: la empleada recibe leave_scope.
      const moved = await as(
        http.patch(`/api/appointments/${mine.body.id}`),
      ).send({ professional_id: ownerId });
      expect(moved.status).toBe(200);
      const after = await pull(employeeToken, employeeCursor);
      expect(
        after.changes.filter((c) => c.id === mine.body.id).map((c) => c.op),
      ).toEqual(['leave_scope']);
      employeeCursor = after.cursor;
      const ownerAfter = await pull(ownerToken, ownerCursor);
      expect(
        ownerAfter.changes.find((c) => c.id === mine.body.id),
      ).toMatchObject({ op: 'upsert', data: { professionalId: ownerId } });
      ownerCursor = ownerAfter.cursor;
    });

    it('cambiar los servicios de una cita sube la versión de la cita (sus líneas van dentro)', async () => {
      const as = (req: any) => req.set(auth(ownerToken));
      const extra = await as(http.post('/api/services')).send({
        name: `Extra ${run}`,
        price: 5000,
        duration: 15,
        categoryId: (
          await ds.query('SELECT category_id FROM services WHERE id = $1', [
            serviceId,
          ])
        )[0].category_id,
      });
      const created = await as(http.post('/api/appointments')).send({
        client_id: clientId,
        professional_id: ownerId,
        service_ids: [serviceId],
        date: `${MONDAY}T15:00:00`,
      });
      ownerCursor = (await pull(ownerToken, ownerCursor)).cursor;
      const changed = await as(
        http.patch(`/api/appointments/${created.body.id}`),
      ).send({
        service_ids: [serviceId, extra.body.id],
      });
      expect(changed.status).toBe(200);
      const { changes, cursor } = await pull(ownerToken, ownerCursor);
      const appt = changes.find((c) => c.id === created.body.id);
      expect(appt.data.services.map((s: any) => s.id).sort()).toEqual(
        [serviceId, extra.body.id].sort(),
      );
      ownerCursor = cursor;
    });

    it('epoch (de la base) y head (versión del negocio): la app detecta otro servidor o una restauración', async () => {
      const get = (token: string, cursor: string) =>
        http.get(`/api/sync/changes?cursor=${cursor}&limit=2`).set(auth(token));
      const first = await get(ownerToken, '0');
      expect(first.body.epoch).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      const [{ value }] = await ds.query(
        `SELECT value FROM sync_meta WHERE key = 'epoch'`,
      );
      expect(first.body.epoch).toBe(value);
      // head ≥ cursor de la página; al terminar de bajar, cursor = head.
      expect(BigInt(first.body.head)).toBeGreaterThanOrEqual(
        BigInt(first.body.cursor),
      );
      const done = await pull(ownerToken, '0');
      const last = await get(ownerToken, done.cursor);
      expect(last.body).toMatchObject({
        changes: [],
        cursor: done.cursor,
        has_more: false,
        head: done.cursor,
        epoch: value,
      });
      // Mismo epoch para otro negocio y para el Employee; head es de cada negocio.
      const other = await get(otherToken, '0');
      expect(other.body.epoch).toBe(value);
      const otherDone = await pull(otherToken, '0');
      expect((await get(otherToken, otherDone.cursor)).body.head).toBe(
        otherDone.cursor,
      );
      expect((await get(employeeToken, '0')).body.epoch).toBe(value);
    });

    it('aislamiento: los cambios de otro negocio no llegan', async () => {
      await http
        .post('/api/clients')
        .set(auth(otherToken))
        .send({
          name: 'Ajena',
          lastname: 'Otro',
          phone: `33${Date.now().toString().slice(-8)}`,
        });
      const { changes } = await pull(ownerToken, ownerCursor);
      expect(changes.some((c) => c.data?.name === 'Ajena')).toBe(false);
      const theirs = await pull(otherToken, '0');
      expect(theirs.changes.some((c) => c.data?.name === 'Ajena')).toBe(true);
      expect(theirs.changes.some((c) => c.id === clientId)).toBe(false);
    });

    it('cursor bajo concurrencia: una transacción abierta frena a la siguiente y el lector no se salta ninguna', async () => {
      const base = (await pull(ownerToken, ownerCursor)).cursor;
      const insert = (qr: any, name: string) =>
        qr.query(
          `INSERT INTO clients (name, lastname, phone, owner_id)
         VALUES ($1, 'Conc', $2, $3) RETURNING id`,
          [name, `34${Math.floor(Math.random() * 1e8)}`, ownerId],
        );
      const first = ds.createQueryRunner();
      const second = ds.createQueryRunner();
      await first.startTransaction();
      await second.startTransaction();
      const [{ id: firstId }] = await insert(first, 'Primera');
      let secondDone = false;
      const secondInsert = insert(second, 'Segunda').then((rows: any) => {
        secondDone = true;
        return rows;
      });
      await new Promise((r) => setTimeout(r, 300));
      // La segunda espera la versión del negocio hasta que la primera confirme.
      expect(secondDone).toBe(false);
      expect((await pull(ownerToken, base)).changes).toEqual([]);
      await first.commitTransaction();
      const [{ id: secondId }] = await secondInsert;
      // Con la primera confirmada y la segunda abierta, el lector ve solo la primera.
      const mid = await pull(ownerToken, base);
      expect(mid.changes.map((c) => c.id)).toEqual([firstId]);
      await second.commitTransaction();
      await first.release();
      await second.release();
      const end = await pull(ownerToken, mid.cursor);
      expect(end.changes.map((c) => c.id)).toEqual([secondId]);

      // Muchas escrituras en paralelo mientras se pagina con límite 2.
      const start = end.cursor;
      const creations = Array.from({ length: 20 }, (_, i) =>
        http
          .post('/api/clients')
          .set(auth(ownerToken))
          .send({
            name: `Paralelo${i}`,
            lastname: 'Sync',
            phone: `35${i.toString().padStart(2, '0')}${Date.now().toString().slice(-6)}`,
          }),
      );
      const seen: string[] = [];
      let cursor = start;
      const reading = (async () => {
        for (let i = 0; i < 40; i++) {
          const page = await pull(ownerToken, cursor, 2);
          seen.push(...page.changes.map((c) => c.id));
          cursor = page.cursor;
          await new Promise((r) => setTimeout(r, 20));
        }
      })();
      const created = await Promise.all(creations);
      await reading;
      const rest = await pull(ownerToken, cursor, 2);
      seen.push(...rest.changes.map((c) => c.id));
      const ids = created.map((r) => r.body.id);
      expect(ids.every(Boolean)).toBe(true);
      expect([...new Set(seen)].sort()).toEqual([...ids].sort());
      expect(seen.length).toBe(new Set(seen).size);
    });

    it('cursor inválido → 400; sin sesión → 401', async () => {
      const bad = await http
        .get('/api/sync/changes?cursor=abc')
        .set(auth(ownerToken));
      expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION_ERROR']);
      expect((await http.get('/api/sync/changes')).status).toBe(401);
    });
  },
);
