/**
 * Clientes (e2e que escriben). Solo corre con
 * `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>` y las migraciones aplicadas en la copia.
 * - 2.20: el email del cliente es opcional (columna nullable, `ClientEmailNullable`).
 * - 2.30: los duplicados salen con `DUPLICATE_PHONE`/`DUPLICATE_EMAIL`.
 * - 2.31: la migración `ClientFakeEmailToNull` dejó en null los emails de relleno.
 * - 2.32: el Employee crea y edita clientes, pero no los borra (solo el Owner).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
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
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable(
  `Email de cliente opcional 2.20 contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User | null;
    let ownerToken: string;
    const stamp = Date.now().toString().slice(-7);
    const phone = (n: number) => `32${n}${stamp}`;

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      ({ owner, employee } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => close?.());

    it("alta sin email o con '' (como la app): 201 y email null (antes 500 / 400)", async () => {
      for (const [i, extra] of [{}, { email: '' }].entries()) {
        const res = await http
          .post('/api/clients')
          .set(auth(ownerToken))
          .send({ name: 'Sin', lastname: 'Email', phone: phone(i), ...extra });
        expect(res.status).toBe(201);
        expect(res.body.email).toBeNull();
      }
    });

    it('ningún cliente conserva el email de relleno no-email@example.com (migración 2.31)', async () => {
      const [{ fake }] = await ds.query(
        `SELECT count(*)::int AS fake FROM clients
          WHERE lower(email) = 'no-email@example.com'`,
      );
      expect(fake).toBe(0);
    });

    it('teléfono repetido sin email: el conflicto es del teléfono, no del email', async () => {
      const res = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ name: 'Otro', lastname: 'Sin', phone: phone(0) });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('teléfono');
      expect(res.body.code).toBe('DUPLICATE_PHONE');
    });

    it('duplicados al crear y al editar: DUPLICATE_PHONE / DUPLICATE_EMAIL con el texto de siempre (2.30)', async () => {
      const email = `dup${stamp}@e2e.local`;
      const first = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ name: 'Dup', lastname: 'Uno', phone: phone(4), email });
      expect(first.status).toBe(201);
      const second = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ name: 'Dup', lastname: 'Dos', phone: phone(5) });
      expect(second.status).toBe(201);

      const sameEmail = await http
        .post('/api/clients')
        .set(auth(ownerToken))
        .send({ name: 'Dup', lastname: 'Tres', phone: phone(6), email });
      expect(sameEmail.body).toEqual({
        statusCode: 409,
        code: 'DUPLICATE_EMAIL',
        message: `Ya existe un cliente con el email: ${email}`,
      });

      const editPhone = await http
        .patch(`/api/clients/${second.body.id}`)
        .set(auth(ownerToken))
        .send({ phone: phone(4) });
      expect(editPhone.body).toEqual({
        statusCode: 409,
        code: 'DUPLICATE_PHONE',
        message: `Ya existe un cliente con el teléfono: ${phone(4)}`,
      });

      const editEmail = await http
        .patch(`/api/clients/${second.body.id}`)
        .set(auth(ownerToken))
        .send({ email });
      expect([editEmail.status, editEmail.body.code]).toEqual([
        409,
        'DUPLICATE_EMAIL',
      ]);
    });

    it('editar con email "" lo deja en null', async () => {
      const [{ id }] = await ds.query(
        `SELECT id FROM clients WHERE owner_id = $1 AND phone = $2`,
        [owner.id, phone(1)],
      );
      await http
        .patch(`/api/clients/${id}`)
        .set(auth(ownerToken))
        .send({ email: 'x@example.com' })
        .expect(200);
      const res = await http
        .patch(`/api/clients/${id}`)
        .set(auth(ownerToken))
        .send({ email: '' });
      expect([res.status, res.body.email]).toEqual([200, null]);
    });

    it('importar contactos sin email: se guardan con email null', async () => {
      const res = await http
        .post('/api/clients/batch')
        .set(auth(ownerToken))
        .send({
          clients: [{ name: 'Contacto', lastname: 'Sin', phone: phone(2) }],
        });
      expect([res.status, res.body.success, res.body.failed]).toEqual([
        201, 1, 0,
      ]);
      const [row] = await ds.query(
        `SELECT email FROM clients WHERE owner_id = $1 AND phone = $2`,
        [owner.id, phone(2)],
      );
      expect(row.email).toBeNull();
    });

    it('Employee: crea y edita un cliente del negocio, pero no lo borra; el Owner sí (2.32)', async () => {
      if (!employee) return;
      const employeeAuth = auth(signToken(employee, ['Employee']));

      const created = await http
        .post('/api/clients')
        .set(employeeAuth)
        .send({ name: 'Del', lastname: 'Empleado', phone: phone(3) });
      expect(created.status).toBe(201);
      expect(created.body.ownerId).toBe(owner.id);
      const { id } = created.body;

      const edited = await http
        .patch(`/api/clients/${id}`)
        .set(employeeAuth)
        .send({ name: 'Editado' });
      expect([edited.status, edited.body.name]).toEqual([200, 'Editado']);

      const denied = await http.delete(`/api/clients/${id}`).set(employeeAuth);
      expect([denied.status, denied.body.code]).toEqual([403, 'FORBIDDEN']);
      const [{ count }] = await ds.query(
        `SELECT count(*)::int AS count FROM clients WHERE id = $1`,
        [id],
      );
      expect(count).toBe(1);

      await http.delete(`/api/clients/${id}`).set(auth(ownerToken)).expect(200);
      const [{ remaining }] = await ds.query(
        `SELECT count(*)::int AS remaining FROM clients WHERE id = $1`,
        [id],
      );
      expect(remaining).toBe(0);
    });
  },
);
