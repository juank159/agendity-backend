/**
 * Tarea 7.03: hallazgos de la prueba del salón (7.01), sobre la copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`). Con los datos de dev: el
 * empleado hace un solo servicio ("Depilación de cejas").
 * (a) roles/planes en migraciones: se comprueba al migrar una BD vacía (ver la
 *     entrega); aquí, que los 3 roles y 3 planes existen.
 * (d) completar antes de empezar: `test/appointment-status.e2e-spec.ts`.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { EmailService } from '../src/email/email.service';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  assertWritableDatabase,
  describeWritable,
  firstFreeWeek,
  futureMonday,
  resetTrialQuota,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable('Hallazgos del salón 7.03 (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User;
  let ownerToken: string;
  let client: Client;
  let offered: string;
  let notOffered: string;
  let date: string;

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
    jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
    const dev = await findDevOwnerAndEmployee(ds);
    owner = dev.owner;
    employee = dev.employee as User;
    ownerToken = signToken(owner, ['Owner']);
    client = await ds
      .getRepository(Client)
      .findOneOrFail({ where: { ownerId: owner.id } });
    const rows: { id: string; offered: boolean }[] = await ds.query(
      `SELECT s.id, EXISTS (
                SELECT 1 FROM user_services us
                 WHERE us.service_id = s.id AND us.user_id = $2 AND us."isActive"
              ) AS offered
         FROM services s
        WHERE s.owner_id = $1 AND s."isActive"`,
      [owner.id, employee.id],
    );
    offered = rows.find((r) => r.offered)!.id;
    notOffered = rows.find((r) => !r.offered)!.id;
    await resetTrialQuota(ds, owner.id, { limit: 1000 });
    // Lunes 10:00 Bogotá de una semana libre (horario del empleado L-V 9-18).
    date = new Date(
      futureMonday(await firstFreeWeek(ds)) + 15 * 3_600_000,
    ).toISOString();
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await close();
  });

  it('(a) los 3 roles y los 3 planes existen (los crea la migración en una BD nueva)', async () => {
    const [{ roles }] = await ds.query(
      `SELECT string_agg(name, ',' ORDER BY name) AS roles FROM roles`,
    );
    expect(roles).toBe('Admin,Employee,Owner');
    const [{ plans }] = await ds.query(
      `SELECT string_agg(duration_months::text, ',' ORDER BY duration_months) AS plans
         FROM subscription_plans WHERE is_active`,
    );
    expect(plans).toBe('1,6,12');
  });

  it('(b) servicio que el profesional no hace: 409 al agendar y en horas libres; el suyo, sí', async () => {
    const book = (serviceIds: string[]) =>
      http.post('/api/appointments').set(auth(ownerToken)).send({
        client_id: client.id,
        professional_id: employee.id,
        service_ids: serviceIds,
        date,
      });
    for (const serviceIds of [[notOffered], [offered, notOffered]]) {
      const res = await book(serviceIds);
      expect([res.status, res.body.code]).toEqual([
        409,
        'SERVICE_NOT_OFFERED_BY_PROFESSIONAL',
      ]);
    }
    const slots = await http
      .get(
        `/api/appointments/available-slots?professional_id=${employee.id}` +
          `&date=${date.slice(0, 10)}&service_ids=${notOffered}`,
      )
      .set(auth(ownerToken));
    expect([slots.status, slots.body.code]).toEqual([
      409,
      'SERVICE_NOT_OFFERED_BY_PROFESSIONAL',
    ]);

    const ok = await book([offered]);
    expect(ok.status).toBe(201);
    // Cambiarle los servicios a uno que no hace: 409 y la cita no cambia.
    const change = await http
      .patch(`/api/appointments/${ok.body.id}`)
      .set(auth(ownerToken))
      .send({ service_ids: [notOffered] });
    expect([change.status, change.body.code]).toEqual([
      409,
      'SERVICE_NOT_OFFERED_BY_PROFESSIONAL',
    ]);
  });

  it('(c) batch de servicios del empleado: comisión de 150 % → 400 en español y no guarda', async () => {
    const before = await ds.query(
      'SELECT count(*)::int AS n FROM user_services WHERE user_id = $1',
      [employee.id],
    );
    const res = await http
      .post(`/api/users/${employee.id}/services/batch`)
      .set(auth(ownerToken))
      .send([{ serviceId: notOffered, commissionPercentage: 150 }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain(
      'La comisión no puede ser mayor que 100 %',
    );
    const after = await ds.query(
      'SELECT count(*)::int AS n FROM user_services WHERE user_id = $1',
      [employee.id],
    );
    expect(after).toEqual(before);
  });

  it('(e) request-code y forgot-password con el SMTP caído: 503 EMAIL_DELIVERY_FAILED con texto claro', async () => {
    const email = app.get(EmailService);
    jest.spyOn(email, 'sendVerificationCode').mockResolvedValue(false);
    jest
      .spyOn(email, 'sendPasswordResetCode')
      .mockRejectedValue(new Error('SMTP caído'));
    for (const path of ['verify/request-code', 'forgot-password']) {
      const res = await http
        .post(`/api/auth/${path}`)
        .send({ email: owner.email });
      expect([res.status, res.body.code]).toEqual([
        503,
        'EMAIL_DELIVERY_FAILED',
      ]);
      expect(res.body.message).toBe(
        'No pudimos enviar el correo con el código. Intenta de nuevo en unos minutos.',
      );
    }
  });
});
