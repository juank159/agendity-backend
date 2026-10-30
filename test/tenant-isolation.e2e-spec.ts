/**
 * Tarea 2.02: aislamiento por tenant en todos los módulos de negocio.
 *
 * Solo lectura sobre los datos reales de la BD de desarrollo:
 * - "Tenant ajeno": token firmado con un Owner que no existe. Lee recursos reales
 *   del negocio de desarrollo y debe recibir 404 o listas vacías.
 * - Escrituras: solo rechazos (404/403). Por si un control fallara, TODA escritura
 *   de TypeORM está bloqueada con espías (lanzan) y se comprueba que no se llamaron.
 * - Employee real: ahora ve los clientes, servicios y categorías de su Owner.
 *   Su alta de cita se prueba interceptando la persistencia (save simulado,
 *   suscripción simulada y sin emitir el evento de recordatorio).
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Schedule } from '../src/schedules/entities/schedule.entity';
import { UserService } from '../src/user-services/entities/user-service.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { SubscriptionsService } from '../src/subscriptions/services/subscriptions.service';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import {
  allowFictitiousAccounts,
  findDevOwnerAndEmployee,
  signToken,
} from './utils/dev-fixtures';

const STRANGER_ID = '22222222-2222-4222-8222-222222222222';
/** Id que no existe en ninguna tabla (citas, pagos, reseñas, bloques… hoy vacías). */
const MISSING_ID = '33333333-3333-4333-8333-333333333333';

const WRITE_METHODS = {
  repository: [
    'save',
    'insert',
    'update',
    'upsert',
    'remove',
    'softRemove',
    'delete',
    'softDelete',
  ],
  manager: ['save', 'insert', 'update', 'upsert', 'remove', 'delete'],
} as const;

describe('Aislamiento por tenant (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User | null;
  let strangerToken: string;
  let employeeToken: string | null;
  let client: Client;
  let service: Service;
  let category: Category;
  let schedule: Schedule | null;
  let userService: UserService | null;
  let notification: Notification | null;
  let writeSpies: jest.SpyInstance[];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Bloquea toda escritura de TypeORM: si algún control fallara, la petición daría 500 y no tocaría la BD. */
  const blockWrites = () => {
    const blocked = () => {
      throw new Error('Escritura bloqueada en el e2e de aislamiento');
    };
    writeSpies = [
      ...WRITE_METHODS.repository.map((m) =>
        jest.spyOn(Repository.prototype, m as any).mockImplementation(blocked),
      ),
      ...WRITE_METHODS.manager.map((m) =>
        jest
          .spyOn(EntityManager.prototype, m as any)
          .mockImplementation(blocked),
      ),
    ];
  };
  const expectNoWrites = () => {
    for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
  };

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    allowFictitiousAccounts(app, [STRANGER_ID]);
    ds = app.get(DataSource);
    ({ owner, employee } = await findDevOwnerAndEmployee(ds));
    if (
      await ds
        .getRepository(User)
        .exist({ where: { id: STRANGER_ID }, withDeleted: true })
    ) {
      throw new Error('STRANGER_ID existe en la BD: cambiarlo');
    }
    strangerToken = signToken(
      { id: STRANGER_ID, name: 'Ajeno', email: 'ajeno2@e2e.local' },
      ['Owner'],
    );
    employeeToken = employee ? signToken(employee, ['Employee']) : null;

    client = await ds
      .getRepository(Client)
      .findOneOrFail({ where: { ownerId: owner.id }, order: { name: 'ASC' } });
    // Activo y, si hay empleado, uno que él hace (7.03: el Employee real
    // agenda para sí mismo solo servicios suyos).
    service = await ds
      .getRepository(Service)
      .createQueryBuilder('service')
      .leftJoin(
        'user_services',
        'us',
        'us.service_id = service.id AND us."isActive" AND us.user_id = :employeeId',
        { employeeId: employee?.id ?? owner.id },
      )
      .where('service.ownerId = :ownerId AND service.isActive = true', {
        ownerId: owner.id,
      })
      .orderBy('us.id IS NULL', 'ASC')
      .addOrderBy('service.name', 'ASC')
      .getOneOrFail();
    category = await ds
      .getRepository(Category)
      .findOneOrFail({ where: { ownerId: owner.id } });
    schedule = await ds.getRepository(Schedule).findOne({
      where: [
        { user: { id: owner.id } },
        { user: { owner: { id: owner.id } } },
      ],
      relations: ['user'],
    });
    userService = await ds.getRepository(UserService).findOne({ where: {} });
    notification = await ds.getRepository(Notification).findOne({ where: {} });
  }, E2E_BOOT_TIMEOUT_MS);

  beforeEach(() => blockWrites());

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await close?.();
  });

  /** Ejecuta las peticiones en serie y devuelve las que no dieron el estado esperado. */
  async function expectStatuses(
    checks: Array<[string, () => ReturnType<E2EHttp['get']>, number]>,
  ) {
    const failures: string[] = [];
    for (const [label, send, expected] of checks) {
      const res = await send();
      if (res.status !== expected) {
        failures.push(
          `${label} -> ${res.status} (esperado ${expected}) ${JSON.stringify(res.body).slice(0, 160)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  }

  describe('tenant ajeno: listas vacías', () => {
    it('no ve nada del negocio de desarrollo en las listas', async () => {
      const t = auth(strangerToken);
      const empty: Array<[string, string]> = [
        ['clients/all', '/api/clients/all'],
        ['services', '/api/services'],
        ['appointments', '/api/appointments'],
        ['payments', '/api/payments'],
        ['custom-payment-methods', '/api/custom-payment-methods'],
        ['custom-payment-methods/active', '/api/custom-payment-methods/active'],
        ['reviews', '/api/reviews'],
        ['time-blocks', '/api/time-blocks'],
      ];
      for (const [label, path] of empty) {
        const res = await http.get(path).set(t);
        expect({ label, status: res.status, body: res.body }).toEqual({
          label,
          status: 200,
          body: [],
        });
      }

      // Categorías: además valida que el Owner exista; para un tenant inexistente es 404.
      const categories = await http.get('/api/categories').set(t);
      expect([200, 404]).toContain(categories.status);
      if (categories.status === 200) expect(categories.body).toEqual([]);

      const clients = await http.get('/api/clients').set(t);
      expect(clients.status).toBe(200);
      expect(clients.body.total).toBe(0);
      expect(clients.body.data).toEqual([]);

      const reviews = await http
        .get(`/api/reviews/professional/${owner.id}`)
        .set(t);
      expect(reviews.status).toBe(200);
      expect(reviews.body).toEqual([]);
      expectNoWrites();
    });

    it('las estadísticas de pagos no incluyen datos del negocio ajeno', async () => {
      const t = auth(strangerToken);
      const range = 'startDate=2020-01-01&endDate=2030-12-31';
      const stats = await http.get(`/api/payments/stats?${range}`).set(t);
      expect(stats.status).toBe(200);
      expect(stats.body).toEqual({
        total_amount: 0,
        payment_count: 0,
        average_amount: 0,
      });
      for (const path of [
        'stats/by-method',
        'stats/by-service',
        'stats/by-professional',
        'stats/by-client',
        'stats/top-clients',
      ]) {
        const res = await http.get(`/api/payments/${path}?${range}`).set(t);
        expect({ path, status: res.status, body: res.body }).toEqual({
          path,
          status: 200,
          body: [],
        });
      }
      const comparison = await http
        .get(`/api/payments/stats/comparison?${range}`)
        .set(t);
      expect(comparison.status).toBe(200);
      expect(comparison.body.current_period.payment_count).toBe(0);

      const employeeStats = await http
        .get(`/api/payments/employee-stats?${range}&professionalId=${owner.id}`)
        .set(t);
      expect(employeeStats.status).toBe(200);
      expect(employeeStats.body.summary.payment_count).toBe(0);
      expectNoWrites();
    });
  });

  describe('tenant ajeno: 404 al leer recursos reales', () => {
    it('clientes, servicios, categorías, horarios, profesionales y notificaciones', async () => {
      const t = auth(strangerToken);
      const professionals = [owner.id, ...(employee ? [employee.id] : [])];
      const checks: Array<[string, () => ReturnType<E2EHttp['get']>, number]> =
        [
          [
            'GET client',
            () => http.get(`/api/clients/${client.id}`).set(t),
            404,
          ],
          [
            'GET service',
            () => http.get(`/api/services/${service.id}`).set(t),
            404,
          ],
          [
            'GET services by category',
            () => http.get(`/api/services/category/${category.id}`).set(t),
            404,
          ],
          [
            'GET category id',
            () => http.get(`/api/categories/${category.id}`).set(t),
            404,
          ],
          [
            'GET category name',
            () =>
              http
                .get(`/api/categories/${encodeURIComponent(category.name)}`)
                .set(t),
            404,
          ],
          [
            'GET appointment',
            () => http.get(`/api/appointments/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET payment',
            () => http.get(`/api/payments/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET payments by appointment',
            () => http.get(`/api/payments/appointment/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET review',
            () => http.get(`/api/reviews/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET time-block',
            () => http.get(`/api/time-blocks/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET custom-payment-method',
            () => http.get(`/api/custom-payment-methods/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'GET whatsapp config',
            () => http.get('/api/whatsapp/config').set(t),
            404,
          ],
          [
            'GET notifications of client',
            () =>
              http
                .get(`/api/notifications/receiver/${client.id}?type=CLIENT`)
                .set(t),
            404,
          ],
          [
            'GET unread count of owner',
            () =>
              http
                .get(`/api/notifications/unread/count/${owner.id}?type=USER`)
                .set(t),
            404,
          ],
        ];
      for (const id of professionals) {
        checks.push(
          [
            'GET schedules of user',
            () => http.get(`/api/schedules/user/${id}`).set(t),
            404,
          ],
          [
            'GET user services',
            () => http.get(`/api/users/${id}/services`).set(t),
            404,
          ],
          [
            'GET time-blocks of user',
            // Las fechas son obligatorias en la práctica: `@QueryDate` (antes ParseDatePipe) rechaza la ausencia (bug previo).
            () =>
              http
                .get(
                  `/api/time-blocks/user/${id}?startDate=2030-01-01&endDate=2030-01-02`,
                )
                .set(t),
            404,
          ],
          [
            'GET available slots',
            () =>
              http
                .get(
                  `/api/appointments/available-slots?professional_id=${id}&date=2030-01-01&service_ids=${MISSING_ID}`,
                )
                .set(t),
            404,
          ],
        );
      }
      if (schedule) {
        checks.push([
          'GET schedule',
          () => http.get(`/api/schedules/${schedule.id}`).set(t),
          404,
        ]);
      }
      if (notification) {
        checks.push([
          'GET notification',
          () => http.get(`/api/notifications/${notification.id}`).set(t),
          404,
        ]);
      }
      await expectStatuses(checks);
      expectNoWrites();
    });
  });

  describe('tenant ajeno: escrituras rechazadas sin tocar la BD', () => {
    it('editar o borrar recursos reales responde 404', async () => {
      const t = auth(strangerToken);
      const checks: Array<[string, () => ReturnType<E2EHttp['get']>, number]> =
        [
          [
            'PATCH client',
            () =>
              http
                .patch(`/api/clients/${client.id}`)
                .set(t)
                .send({ name: client.name }),
            404,
          ],
          [
            'DELETE client',
            () => http.delete(`/api/clients/${client.id}`).set(t),
            404,
          ],
          [
            'PATCH service',
            () =>
              http
                .patch(`/api/services/${service.id}`)
                .set(t)
                .send({ categoryId: category.id }),
            404,
          ],
          [
            'DELETE service',
            () => http.delete(`/api/services/${service.id}`).set(t),
            404,
          ],
          [
            'PATCH category',
            () =>
              http
                .patch(`/api/categories/${category.id}`)
                .set(t)
                .send({ name: category.name }),
            404,
          ],
          [
            'DELETE category',
            () => http.delete(`/api/categories/${category.id}`).set(t),
            404,
          ],
          [
            'PATCH appointment',
            () =>
              http
                .patch(`/api/appointments/${MISSING_ID}`)
                .set(t)
                .send({ notes: 'x' }),
            404,
          ],
          [
            'DELETE appointment',
            () => http.delete(`/api/appointments/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'POST send-reminder',
            () =>
              http.post(`/api/appointments/${MISSING_ID}/send-reminder`).set(t),
            404,
          ],
          [
            'PATCH mark-sent',
            () =>
              http
                .patch(`/api/appointments/${MISSING_ID}/reminder/mark-sent`)
                .set(t),
            404,
          ],
          [
            'PATCH cancel (2.06)',
            () =>
              http
                .patch(`/api/appointments/${MISSING_ID}/cancel`)
                .set(t)
                .send({ cancellation_reason: 'prueba e2e' }),
            404,
          ],
          [
            'PATCH complete (2.06)',
            () => http.patch(`/api/appointments/${MISSING_ID}/complete`).set(t),
            404,
          ],
          [
            'POST refund',
            () =>
              http
                .post(`/api/payments/${MISSING_ID}/refund`)
                .set(t)
                .send({ refund_amount: 1, refund_reason: 'prueba e2e' }),
            404,
          ],
          [
            'PATCH custom-payment-method',
            () =>
              http
                .patch(`/api/custom-payment-methods/${MISSING_ID}`)
                .set(t)
                .send({ name: 'x' }),
            404,
          ],
          [
            'DELETE review',
            () => http.delete(`/api/reviews/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'DELETE time-block',
            () => http.delete(`/api/time-blocks/${MISSING_ID}`).set(t),
            404,
          ],
          [
            'PATCH whatsapp config',
            () =>
              http.patch(`/api/whatsapp/config/${MISSING_ID}`).set(t).send({}),
            404,
          ],
          [
            'PATCH notifications read-all',
            () =>
              http
                .patch(`/api/notifications/read-all/${client.id}?type=CLIENT`)
                .set(t),
            404,
          ],
        ];
      if (schedule) {
        checks.push(
          [
            'PATCH schedule',
            () => http.patch(`/api/schedules/${schedule.id}`).set(t).send({}),
            404,
          ],
          [
            'DELETE schedule',
            () => http.delete(`/api/schedules/${schedule.id}`).set(t),
            404,
          ],
        );
      }
      if (notification) {
        checks.push(
          [
            'PATCH notification read',
            () =>
              http.patch(`/api/notifications/read/${notification.id}`).set(t),
            404,
          ],
          [
            'DELETE notification',
            () => http.delete(`/api/notifications/${notification.id}`).set(t),
            404,
          ],
        );
      }
      if (userService) {
        checks.push([
          'DELETE user service',
          () =>
            http
              .delete(
                `/api/users/${userService.userId}/services/${userService.serviceId}`,
              )
              .set(t),
          404,
        ]);
      }
      await expectStatuses(checks);
      expectNoWrites();
    });

    it('crear usando recursos de otro negocio responde 404 (y la cita no toca la suscripción)', async () => {
      const t = auth(strangerToken);
      const consumeQuota = jest.spyOn(
        SubscriptionsService.prototype,
        'consumeAppointmentQuota',
      );
      const professionalId = employee?.id ?? owner.id;
      await expectStatuses([
        [
          'POST appointment',
          () =>
            http
              .post('/api/appointments')
              .set(t)
              .send({
                client_id: client.id,
                professional_id: professionalId,
                service_ids: [service.id],
                date: '2030-01-01T10:00:00',
              }),
          404,
        ],
        [
          'POST service (categoría ajena)',
          () =>
            http
              .post('/api/services')
              .set(t)
              .send({
                name: `e2e-aislamiento-${Date.now()}`,
                price: 1,
                duration: 30,
                categoryId: category.id,
              }),
          404,
        ],
        [
          'POST schedule',
          () =>
            http.post('/api/schedules').set(t).send({
              user_id: professionalId,
              day_of_week: 1,
              start_time: '01:00',
              end_time: '02:00',
              is_available: true,
            }),
          404,
        ],
        [
          'POST schedules batch',
          () =>
            http.post(`/api/schedules/batch/${professionalId}`).set(t).send([]),
          404,
        ],
        [
          'POST user service',
          () =>
            http
              .post(`/api/users/${professionalId}/services`)
              .set(t)
              .send({ serviceId: service.id }),
          404,
        ],
        // POST /time-blocks no se prueba aquí: hoy responde 400 a cualquier fecha
        // (el DTO declara `Date` y la conversión implícita rompe @IsDateString; bug previo).
        [
          'POST payment',
          () =>
            http.post('/api/payments').set(t).send({
              appointment_id: MISSING_ID,
              amount: 1,
              payment_method: 'CASH',
            }),
          404,
        ],
        [
          'POST review',
          () =>
            http.post('/api/reviews').set(t).send({
              appointment_id: MISSING_ID,
              rating: 5,
              comment: 'comentario de prueba e2e',
            }),
          404,
        ],
      ]);
      expect(consumeQuota).not.toHaveBeenCalled();
      expectNoWrites();
    });
  });

  describe('Owner real: sigue viendo su negocio', () => {
    it('lee sus pagos, categorías y notificaciones (control positivo)', async () => {
      const t = auth(signToken(owner, ['Owner']));
      await expectStatuses([
        ['GET payments', () => http.get('/api/payments').set(t), 200],
        ['GET categories', () => http.get('/api/categories').set(t), 200],
        [
          'GET category',
          () => http.get(`/api/categories/${category.id}`).set(t),
          200,
        ],
        ['GET client', () => http.get(`/api/clients/${client.id}`).set(t), 200],
        [
          'GET unread count (USER propio)',
          () =>
            http
              .get(`/api/notifications/unread/count/${owner.id}?type=USER`)
              .set(t),
          200,
        ],
        [
          'GET notifications of own client',
          () =>
            http
              .get(`/api/notifications/receiver/${client.id}?type=CLIENT`)
              .set(t),
          200,
        ],
        ...(employee
          ? ([
              [
                'GET schedules of employee',
                () => http.get(`/api/schedules/user/${employee.id}`).set(t),
                200,
              ],
            ] as Array<[string, () => ReturnType<E2EHttp['get']>, number]>)
          : []),
      ]);
      expectNoWrites();
    });
  });

  describe('Employee real: trabaja con los datos de su Owner', () => {
    it('ve los clientes, servicios y categorías del negocio', async () => {
      if (!employeeToken) return;
      const t = auth(employeeToken);

      const totalClients = await ds
        .getRepository(Client)
        .count({ where: { ownerId: owner.id } });
      const clients = await http.get('/api/clients?limit=5').set(t);
      expect(clients.status).toBe(200);
      expect(clients.body.total).toBe(totalClients);
      expect(clients.body.total).toBeGreaterThan(0);

      const ownClient = await http.get(`/api/clients/${client.id}`).set(t);
      expect(ownClient.status).toBe(200);
      expect(ownClient.body.id).toBe(client.id);

      const activeServices = await ds
        .getRepository(Service)
        .count({ where: { ownerId: owner.id, isActive: true } });
      const services = await http.get('/api/services').set(t);
      expect(services.status).toBe(200);
      expect(services.body).toHaveLength(activeServices);
      expect(
        (services.body as Service[]).every((s) => s.ownerId === owner.id),
      ).toBe(true);

      const oneService = await http.get(`/api/services/${service.id}`).set(t);
      expect(oneService.status).toBe(200);

      const totalCategories = await ds
        .getRepository(Category)
        .count({ where: { ownerId: owner.id } });
      const categories = await http.get('/api/categories').set(t);
      expect(categories.status).toBe(200);
      expect(categories.body).toHaveLength(totalCategories);

      const oneCategory = await http
        .get(`/api/categories/${category.id}`)
        .set(t);
      expect(oneCategory.status).toBe(200);

      const appointments = await http.get('/api/appointments').set(t);
      expect(appointments.status).toBe(200);
      expect(Array.isArray(appointments.body)).toBe(true);

      const schedules = await http
        .get(`/api/schedules/user/${employee.id}`)
        .set(t);
      expect(schedules.status).toBe(200);

      const assigned = await http
        .get(`/api/users/${employee.id}/services`)
        .set(t);
      expect(assigned.status).toBe(200);
      expectNoWrites();
    });

    it('sigue sin poder editar ni borrar el catálogo ni las citas, ni borrar clientes (403)', async () => {
      if (!employeeToken) return;
      const t = auth(employeeToken);
      await expectStatuses([
        [
          'PATCH service',
          () => http.patch(`/api/services/${service.id}`).set(t).send({}),
          403,
        ],
        [
          'DELETE service',
          () => http.delete(`/api/services/${service.id}`).set(t),
          403,
        ],
        [
          'POST category',
          () => http.post('/api/categories').set(t).send({ name: 'x' }),
          403,
        ],
        [
          'DELETE category',
          () => http.delete(`/api/categories/${category.id}`).set(t),
          403,
        ],
        [
          'DELETE client (solo Owner, 2.32)',
          () => http.delete(`/api/clients/${client.id}`).set(t),
          403,
        ],
        [
          'PATCH appointment',
          () => http.patch(`/api/appointments/${MISSING_ID}`).set(t).send({}),
          403,
        ],
        [
          'DELETE appointment',
          () => http.delete(`/api/appointments/${MISSING_ID}`).set(t),
          403,
        ],
        [
          'POST review (solo Owner, 2.15)',
          () => http.post('/api/reviews').set(t).send({}),
          403,
        ],
        [
          'POST appointment para otro profesional (2.15)',
          () =>
            http
              .post('/api/appointments')
              .set(t)
              .send({
                client_id: client.id,
                professional_id: owner.id,
                service_ids: [service.id],
                date: '2030-01-07T10:00:00-05:00',
              }),
          403,
        ],
        [
          'POST whatsapp config',
          () => http.post('/api/whatsapp/config').set(t).send({}),
          403,
        ],
        [
          'GET whatsapp config (trae el apiKey del Owner)',
          () => http.get('/api/whatsapp/config').set(t),
          403,
        ],
      ]);
      expectNoWrites();
    });

    it('crea una cita del negocio con owner_id = tenant (persistencia interceptada)', async () => {
      if (!employeeToken) return;
      jest.restoreAllMocks(); // sustituye el bloqueo por un save simulado
      const saved: any[] = [];
      const save = jest
        .spyOn(Repository.prototype, 'save')
        .mockImplementation(async (entity: any) => {
          saved.push(entity);
          return { id: MISSING_ID, ...entity };
        });
      blockOtherWrites();
      // El cupo se consume en la transacción de la cita (2.03): aquí se simula.
      const consumeQuota = jest
        .spyOn(SubscriptionsService.prototype, 'consumeAppointmentQuota')
        .mockResolvedValue({ canCreateAppointment: true });
      const emit = jest
        .spyOn(app.get(EventEmitter2), 'emit')
        .mockReturnValue(true);

      const res = await http
        .post('/api/appointments')
        .set(auth(employeeToken))
        .send({
          client_id: client.id,
          professional_id: employee.id,
          service_ids: [service.id],
          date: '2099-01-05T10:00:00',
        });

      expect(res.status).toBe(201);
      expect(saved).toHaveLength(1);
      expect(saved[0].ownerId).toBe(owner.id);
      expect(saved[0].professionalId).toBe(employee.id);
      expect(consumeQuota).toHaveBeenCalledWith(owner.id, expect.anything());
      expect(emit).toHaveBeenCalledWith(
        'appointment.created',
        expect.anything(),
      );
      expect(save).toHaveBeenCalledTimes(1);
      for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();

      function blockOtherWrites() {
        const blocked = () => {
          throw new Error('Escritura bloqueada en el e2e de aislamiento');
        };
        writeSpies = [
          ...WRITE_METHODS.repository
            .filter((m) => m !== 'save')
            .map((m) =>
              jest
                .spyOn(Repository.prototype, m as any)
                .mockImplementation(blocked),
            ),
          ...WRITE_METHODS.manager.map((m) =>
            jest
              .spyOn(EntityManager.prototype, m as any)
              .mockImplementation(blocked),
          ),
        ];
      }
    });
  });
});
