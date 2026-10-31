/**
 * Auditoría 2026-11-01: claves que llegan del cliente y apuntan a filas de
 * OTRO negocio. Negocio A intenta usar el servicio de B al dar de alta o editar
 * una empleada → 404 y nada cambia en B ni en A. Escribe: solo en una copia.
 * (El `id` ajeno en `POST /clients/batch` y en `/sync/push` está en
 * `test/sync-push.e2e-spec.ts`.)
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { assertWritableDatabase, describeWritable } from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable('Claves de otro negocio (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  const run = randomUUID().slice(0, 8);
  let tokenA: string;
  let tokenB: string;
  let serviceA: string;
  let serviceB: string;
  let employeeA: string;
  let n = 0;
  const phone = () => `3${(Date.now() + ++n).toString().slice(-9)}`;

  async function business(name: string) {
    const reg = await http.post('/api/auth/register/owner').send({
      name: 'Dueña',
      lastname: `Negocio ${name === 'A' ? 'Uno' : 'Dos'}`,
      email: `refs-${name}-${run}@example.com`,
      phone: phone(),
      password: 'Secreta1!',
    });
    const token = reg.body.token;
    const category = await http
      .post('/api/categories')
      .set(auth(token))
      .send({ name: `Cat ${name} ${run}` });
    const service = await http
      .post('/api/services')
      .set(auth(token))
      .send({
        name: `Servicio ${name} ${run}`,
        price: 50000,
        duration: 30,
        categoryId: category.body.id,
      });
    return { token, serviceId: service.body.id };
  }

  const serviceRow = (id: string) =>
    ds
      .query('SELECT name, owner_id, price FROM services WHERE id = $1', [id])
      .then((rows) => rows[0]);

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
    ({ token: tokenA, serviceId: serviceA } = await business('A'));
    ({ token: tokenB, serviceId: serviceB } = await business('B'));
    const emp = await http
      .post('/api/auth/register/employee')
      .set(auth(tokenA))
      .send({
        name: 'Laura',
        lastname: 'Refs',
        email: `refs-emp-${run}@example.com`,
        phone: phone(),
        password: 'Secreta1!',
        services: [{ serviceId: serviceA }],
      });
    expect(emp.status).toBe(201);
    employeeA = emp.body.user?.id ?? emp.body.id;
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => close());

  it('alta de empleada con un servicio de otro negocio → 404, sin empleada ni asignación', async () => {
    const before = await serviceRow(serviceB);
    const email = `refs-otra-${run}@example.com`;
    const res = await http
      .post('/api/auth/register/employee')
      .set(auth(tokenA))
      .send({
        name: 'Otra',
        lastname: 'Refs',
        email,
        phone: phone(),
        password: 'Secreta1!',
        services: [{ serviceId: serviceB }],
      });
    expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(
      await ds.query('SELECT 1 FROM users WHERE email = $1', [email]),
    ).toHaveLength(0);
    expect(
      await ds.query('SELECT 1 FROM user_services WHERE service_id = $1', [
        serviceB,
      ]),
    ).toHaveLength(0);
    expect(await serviceRow(serviceB)).toEqual(before);
  });

  it('editar la empleada con un servicio de otro negocio → 404 y sus asignaciones no cambian', async () => {
    const before = await ds.query(
      'SELECT service_id FROM user_services WHERE user_id = $1',
      [employeeA],
    );
    const res = await http
      .patch(`/api/auth/employee/${employeeA}`)
      .set(auth(tokenA))
      .send({ services: [{ serviceId: serviceB }] });
    expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(
      await ds.query(
        'SELECT service_id FROM user_services WHERE user_id = $1',
        [employeeA],
      ),
    ).toEqual(before);
    // B no ve nada raro: su servicio sigue igual y sin asignaciones ajenas.
    const own = await http.get(`/api/services/${serviceB}`).set(auth(tokenB));
    expect(own.status).toBe(200);
  });
});
