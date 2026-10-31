/**
 * `GET /auth/me/services` (2026-10-31): cada empleada ve SOLO sus servicios
 * asignados y activos; el Owner, todos los activos del negocio. Escribe: solo
 * contra una copia (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`).
 */
import { INestApplication } from '@nestjs/common';
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

describeWritable('GET /auth/me/services (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  const run = randomUUID().slice(0, 8);
  let ownerToken: string;
  let ownerId: string;
  const services: Record<string, string> = {};
  const employees: Record<string, { id: string; token: string }> = {};

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
    const reg = await http.post('/api/auth/register/owner').send({
      name: 'Dueña',
      lastname: 'Mios',
      email: `mine-${run}@example.com`,
      phone: `3${Date.now().toString().slice(-9)}`,
      password: 'Secreta1!',
    });
    ownerToken = reg.body.token;
    ownerId = reg.body.user.id;
    const as = (req: any) => req.set(auth(ownerToken));
    const category = await as(http.post('/api/categories')).send({
      name: `Cat ${run}`,
    });
    for (const [key, price] of [
      ['cejas', 30000],
      ['pestanas', 150000],
      ['inactivo', 10000],
    ] as const) {
      services[key] = (
        await as(http.post('/api/services')).send({
          name: `${key} ${run}`,
          price,
          duration: 45,
          categoryId: category.body.id,
        })
      ).body.id;
    }
    // La API no desactiva servicios (solo los borra): se marca en la copia.
    await ds.query('UPDATE services SET "isActive" = false WHERE id = $1', [
      services.inactivo,
    ]);
    for (const [i, name] of ['Ana', 'Laura'].entries()) {
      const emp = await as(http.post('/api/auth/register/employee')).send({
        name,
        lastname: 'Mios',
        email: `mine-${name}-${run}@example.com`,
        phone: `3${(Date.now() + i + 1).toString().slice(-9)}`,
        password: 'Secreta1!',
      });
      const id = emp.body.user.id;
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
        [id],
      );
      employees[name] = {
        id,
        token: signToken(
          {
            id,
            name,
            email: `mine-${name}-${run}@example.com`,
            owner: { id: ownerId },
          },
          ['Employee'],
        ),
      };
    }
    // Ana: cejas (30 %), pestañas desactivada para ella y el servicio inactivo.
    await as(http.post(`/api/users/${employees.Ana.id}/services/batch`)).send([
      { serviceId: services.cejas, commissionPercentage: 30 },
      { serviceId: services.pestanas, isActive: false },
      { serviceId: services.inactivo },
    ]);
    // Laura: pestañas.
    await as(http.post(`/api/users/${employees.Laura.id}/services/batch`)).send(
      [{ serviceId: services.pestanas }],
    );
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => close());

  it('cada empleada ve solo sus servicios activos, con precio, duración y su comisión', async () => {
    const ana = await http
      .get('/api/auth/me/services')
      .set(auth(employees.Ana.token));
    expect(ana.status).toBe(200);
    expect(ana.body).toEqual([
      {
        id: services.cejas,
        name: `cejas ${run}`,
        duration: 45,
        price: 30000,
        color: expect.any(String),
        category: { id: expect.any(String), name: `Cat ${run}` },
        commission_percentage: 30,
      },
    ]);
    const laura = await http
      .get('/api/auth/me/services')
      .set(auth(employees.Laura.token));
    expect(laura.body.map((s: any) => s.id)).toEqual([services.pestanas]);
    // Ninguna ve los de la otra.
    expect(ana.body.map((s: any) => s.id)).not.toContain(services.pestanas);
    expect(laura.body.map((s: any) => s.id)).not.toContain(services.cejas);
  });

  it('el Owner ve todos los activos del negocio (los hace todos)', async () => {
    const res = await http.get('/api/auth/me/services').set(auth(ownerToken));
    expect(res.body.map((s: any) => s.id).sort()).toEqual(
      [services.cejas, services.pestanas].sort(),
    );
  });

  it('sin sesión: 401', async () => {
    expect((await http.get('/api/auth/me/services')).status).toBe(401);
  });
});
