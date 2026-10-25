/**
 * Tarea 2.17: robustez de escrituras en varios pasos y errores al filtro global.
 *
 * - Solo lectura (corre siempre): el lote de horarios valida su cuerpo.
 * - Escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`): lote de
 *   horarios todo o nada, import de clientes con una fila que falla en la BD y
 *   borrar una categoría con servicios en uso (409, no 500).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Robustez 2.17 (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let employee: User;
  let ownerToken: string;
  const writes: string[] = [];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    const dev = await findDevOwnerAndEmployee(app.get(DataSource));
    employee = dev.employee as User;
    ownerToken = signToken(dev.owner, ['Owner']);
  });

  beforeEach(() => {
    writes.length = 0;
    const block = (proto: object, methods: string[], label: string) =>
      methods.forEach((m) =>
        jest.spyOn(proto as any, m).mockImplementation(() => {
          writes.push(`${label}.${m}`);
          throw new Error('Escritura bloqueada en un test de solo lectura');
        }),
      );
    block(
      Repository.prototype,
      ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
      'Repository',
    );
    block(
      EntityManager.prototype,
      ['save', 'insert', 'update', 'remove', 'delete'],
      'EntityManager',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(writes).toEqual([]);
  });

  afterAll(async () => close?.());

  it.each([
    [
      'día fuera de rango',
      [
        {
          day_of_week: 9,
          start_time: '08:00',
          end_time: '09:00',
          is_available: true,
        },
      ],
    ],
    [
      'hora mal escrita',
      [
        {
          day_of_week: 6,
          start_time: '8',
          end_time: '09:00',
          is_available: true,
        },
      ],
    ],
    [
      'campo extra',
      [
        {
          day_of_week: 6,
          start_time: '08:00',
          end_time: '09:00',
          is_available: true,
          user_id: 'x',
        },
      ],
    ],
    ['no es un array', { day_of_week: 6 }],
  ])('POST /schedules/batch con %s → 400 sin escribir', async (_l, body) => {
    const res = await http
      .post(`/api/schedules/batch/${employee.id}`)
      .set(auth(ownerToken))
      .send(body);
    expect(res.status).toBe(400);
  });

  it('POST /schedules/batch/no-uuid → 400', async () => {
    const res = await http
      .post('/api/schedules/batch/no-uuid')
      .set(auth(ownerToken))
      .send([]);
    expect(res.status).toBe(400);
  });
});

describeWritable(
  `Robustez 2.17 contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User;
    let ownerToken: string;
    const saturday = (start: string, end: string) => ({
      day_of_week: 6,
      start_time: start,
      end_time: end,
      is_available: true,
    });
    const saturdayRows = () =>
      ds.query(
        `SELECT id FROM schedules WHERE "userId" = $1 AND day_of_week = 6`,
        [employee.id],
      );

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      const dev = await findDevOwnerAndEmployee(ds);
      owner = dev.owner;
      employee = dev.employee as User;
      ownerToken = signToken(owner, ['Owner']);
      // Precondición: el empleado de dev no trabaja los sábados.
      await ds.query(
        `DELETE FROM schedules WHERE "userId" = $1 AND day_of_week = 6`,
        [employee.id],
      );
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      // Sin sábados: otros specs cuentan con que el sábado está fuera de horario.
      await ds.query(
        `DELETE FROM schedules WHERE "userId" = $1 AND day_of_week = 6`,
        [employee.id],
      );
      await close?.();
    });

    it('lote de horarios: un solape a mitad no deja guardado ninguno; uno válido guarda todos', async () => {
      const bad = await http
        .post(`/api/schedules/batch/${employee.id}`)
        .set(auth(ownerToken))
        .send([saturday('08:00', '10:00'), saturday('09:00', '11:00')]);
      expect(bad.status).toBe(400);
      expect(await saturdayRows()).toHaveLength(0);

      const ok = await http
        .post(`/api/schedules/batch/${employee.id}`)
        .set(auth(ownerToken))
        .send([saturday('08:00', '10:00'), saturday('10:00', '12:00')]);
      expect(ok.status).toBe(201);
      expect(await saturdayRows()).toHaveLength(2);
    });

    it('import de clientes: una fila que falla en la BD no tumba a las demás (savepoint)', async () => {
      const existing = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      const stamp = Date.now().toString().slice(-7);
      const phones = [`300${stamp}`, existing.phone, `301${stamp}`];
      // Simula una alta simultánea: la comprobación previa no ve al cliente
      // existente y el INSERT choca con el índice único (23505).
      const original = EntityManager.prototype.findOne;
      jest
        .spyOn(EntityManager.prototype, 'findOne')
        .mockImplementation(function (this: EntityManager, ...args: any[]) {
          if (args[1]?.where?.phone === existing.phone) {
            return Promise.resolve(null);
          }
          return (original as any).apply(this, args);
        });

      const res = await http
        .post('/api/clients/batch')
        .set(auth(ownerToken))
        .send({
          clients: phones.map((phone, i) => ({
            name: `Import217 ${i}`,
            lastname: 'Prueba',
            email: `import217.${stamp}.${i}@example.com`,
            phone,
          })),
        });
      jest.restoreAllMocks();

      expect(res.status).toBe(201);
      expect([res.body.success, res.body.failed]).toEqual([2, 1]);
      expect(res.body.errors[0].error).toContain('ya existe');
      const saved = await ds.query(
        `SELECT phone FROM clients WHERE owner_id = $1 AND phone = ANY($2)`,
        [owner.id, [phones[0], phones[2]]],
      );
      expect(saved).toHaveLength(2); // antes: 0 (ROLLBACK de todo)
    });

    it('borrar una categoría con servicios en uso → 409 CONFLICT (antes 500) y sigue existiendo', async () => {
      const [category] = await ds.query(
        `SELECT c.id FROM categories c
           JOIN services s ON s.category_id = c.id
           JOIN user_services us ON us.service_id = s.id
          WHERE c.owner_id = $1 LIMIT 1`,
        [owner.id],
      );
      if (!category)
        throw new Error('La copia no tiene categoría con servicios asignados');
      const res = await http
        .delete(`/api/categories/${category.id}`)
        .set(auth(ownerToken));
      expect([res.status, res.body.code]).toEqual([409, 'CONFLICT']);
      const [still] = await ds.query('SELECT 1 FROM categories WHERE id = $1', [
        category.id,
      ]);
      expect(still).toBeDefined();
    });
  },
);
