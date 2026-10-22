/**
 * Tarea 1.03: acceso a usuarios acotado a "uno mismo o mis empleados".
 *
 * Estrategia para no tocar datos reales de la BD de desarrollo:
 * - Casos de rechazo: un Owner ajeno (token firmado con un id que no existe en la BD)
 *   y el empleado real contra su Owner. Responden 404/403/400 ANTES de escribir.
 * - Caso permitido: PATCH idempotente (se envía el mismo nombre que ya tiene) y se
 *   comprueba que la fila no cambió (ni `name` ni `updated_at`).
 * - No se borra a nadie: `DELETE /users/:id` ya no existe (1.21) y, por si acaso,
 *   `Repository.remove/softDelete` están interceptados en los tests que lo tocan.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

const STRANGER_ID = '11111111-1111-4111-8111-111111111111';

describe('Acceso a usuarios por Owner (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User | null;
  let ownerToken: string;
  let strangerToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    ({ owner, employee } = await findDevOwnerAndEmployee(ds));
    ownerToken = signToken(owner, ['Owner']);
    strangerToken = signToken(
      {
        id: STRANGER_ID,
        name: 'Ajeno',
        email: 'ajeno@e2e.local',
        tenant_id: STRANGER_ID,
      },
      ['Owner'],
    );
    const exists = await ds
      .getRepository(User)
      .exist({ where: { id: STRANGER_ID }, withDeleted: true });
    if (exists) throw new Error('STRANGER_ID existe en la BD: cambiarlo');
  }, 60000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await close?.();
  });

  const targets = () =>
    [owner, employee].filter((u): u is User => !!u).map((u) => u.id);

  it('un Owner ajeno recibe 404 al leer, editar o cambiar la imagen', async () => {
    // Red de seguridad: si el control fallara, el DELETE no debe borrar datos reales.
    const remove = jest
      .spyOn(Repository.prototype, 'remove')
      .mockImplementation(async (entity) => entity);
    const failures: string[] = [];
    for (const id of targets()) {
      const user = await ds.getRepository(User).findOneBy({ id });
      const checks: Array<[string, () => ReturnType<E2EHttp['get']>]> = [
        [
          `GET ${id}`,
          () => http.get(`/api/users/${id}`).set(auth(strangerToken)),
        ],
        [
          `GET ${user.email}`,
          () => http.get(`/api/users/${user.email}`).set(auth(strangerToken)),
        ],
        [
          `PATCH ${id}`,
          () =>
            http
              .patch(`/api/users/${id}`)
              .set(auth(strangerToken))
              .send({ name: user.name }), // idempotente: aunque fallara, no cambia nada
        ],
        [
          `PATCH ${id}/image`,
          () => http.patch(`/api/users/${id}/image`).set(auth(strangerToken)),
        ],
      ];
      // Cada petición se crea justo antes de enviarla: supertest hace listen(0)
      // sobre el mismo servidor al crear la petición y crearlas por adelantado
      // deja puertos viejos (ECONNREFUSED intermitente).
      for (const [label, send] of checks) {
        const res = await send();
        if (res.status !== 404) failures.push(`${label} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });

  it('GET /users solo lista al Owner y a sus empleados', async () => {
    const res = await http.get('/api/users').set(auth(ownerToken));
    expect(res.status).toBe(200);
    const employeeIds = (
      await ds.getRepository(User).find({ where: { owner: { id: owner.id } } })
    ).map((u) => u.id);
    const allowed = new Set([owner.id, ...employeeIds]);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain(owner.id);
    expect(ids.filter((id) => !allowed.has(id))).toEqual([]);

    const stranger = await http.get('/api/users').set(auth(strangerToken));
    expect(stranger.status).toBe(200);
    expect(stranger.body).toEqual([]);
  });

  it('PATCH /users/:id rechaza password y email con 400 (sin escribir)', async () => {
    for (const body of [
      { password: 'NuevaClave#123' },
      { email: 'otro@e2e.local' },
      { name: owner.name, password: 'NuevaClave#123' },
    ]) {
      const res = await http
        .patch(`/api/users/${owner.id}`)
        .set(auth(ownerToken))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('DELETE /users/:id ya no existe (1.21): 404 de ruta y no borra nada', async () => {
    const remove = jest
      .spyOn(Repository.prototype, 'remove')
      .mockImplementation(async (entity) => entity);
    const softDelete = jest
      .spyOn(Repository.prototype, 'softDelete')
      .mockImplementation(async () => ({
        raw: [],
        affected: 0,
        generatedMaps: [],
      }));
    for (const target of [owner, employee].filter((u): u is User => !!u)) {
      const res = await http
        .delete(`/api/users/${target.id}`)
        .set(auth(ownerToken));
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Recurso no encontrado');
    }
    expect(remove).not.toHaveBeenCalled();
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('PATCH idempotente del propio Owner y de su empleado: 200 sin cambios en la BD', async () => {
    const repo = ds.getRepository(User);
    for (const target of [owner, employee].filter((u): u is User => !!u)) {
      const before = await repo.findOneByOrFail({ id: target.id });
      const res = await http
        .patch(`/api/users/${target.id}`)
        .set(auth(ownerToken))
        .send({ name: before.name });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(before.name);
      const after = await repo.findOneByOrFail({ id: target.id });
      expect(after.name).toBe(before.name);
      expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
    }
  });

  it('el empleado no puede editar ni leer a su Owner', async () => {
    if (!employee) return;
    const employeeToken = signToken(employee, ['Employee']);
    const patch = await http
      .patch(`/api/users/${owner.id}`)
      .set(auth(employeeToken))
      .send({ name: owner.name });
    expect(patch.status).toBe(404);
    // GET /users/:param es solo para Owner.
    const get = await http
      .get(`/api/users/${owner.id}`)
      .set(auth(employeeToken));
    expect(get.status).toBe(403);
  });

  it('verify/employee-email: 404 si el empleado no es del Owner que llama', async () => {
    if (!employee) return;
    const res = await http
      .post('/api/auth/verify/employee-email')
      .set(auth(strangerToken))
      .send({ employee_id: employee.id, code: '000000' });
    expect(res.status).toBe(404);
  });

  it('verify/employee-email: el Owner propio pasa el control y un código erróneo da 401 (sin escribir)', async () => {
    if (!employee) return;
    const res = await http
      .post('/api/auth/verify/employee-email')
      .set(auth(ownerToken))
      .send({ employee_id: employee.id, code: 'no-es-un-codigo' });
    expect(res.status).toBe(401);
  });
});
