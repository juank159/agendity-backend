/**
 * Tarea 2.16: los empleados nacen inactivos y se activan al verificar el email.
 * Flujo completo de la app: alta → inactivo (se configura igual) → no se puede
 * activar a mano ni agendar → código → verificar → activo y agendable.
 * Escribe de verdad: SOLO contra una copia temporal de la BD
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`). En la corrida normal se omite.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { Schedule } from '../src/schedules/entities/schedule.entity';
import { UserService } from '../src/user-services/entities/user-service.entity';
import { EmailService } from '../src/email/email.service';
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
  resetTrialQuota,
  firstFreeWeek,
  futureMonday,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describeWritable(
  `Empleados nacen inactivos (2.16) contra la copia ${WRITABLE_DB} (e2e, escribe)`,
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let ownerToken: string;
    let client: Client;
    let service: Service;
    let employeeId: string;
    let day = 0;

    // Únicos por corrida: la copia acumula altas de corridas anteriores.
    const suffix = String(Date.now()).slice(-9);
    const email = `e2e.216.${suffix}@agendity.test`;
    const phone = `3${suffix}`;

    const employeeRow = () =>
      ds.getRepository(User).findOneOrFail({ where: { id: employeeId } });

    /** Cita a FUTURO (2.21), un lunes distinto cada vez, 10:00 Bogotá. */
    const book = () => {
      day += 1;
      return http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: employeeId,
          service_ids: [service.id],
          date: new Date(futureMonday(day) + 15 * 3_600_000).toISOString(),
        });
    };

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      // Nunca enviar correos reales.
      jest
        .spyOn(EmailService.prototype, 'sendVerificationCode')
        .mockResolvedValue(true);
      ({ owner } = await findDevOwnerAndEmployee(ds));
      ownerToken = signToken(owner, ['Owner']);
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      service = await ds
        .getRepository(Service)
        .findOneOrFail({ where: { ownerId: owner.id } });
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      day = await firstFreeWeek(ds);
    }, E2E_BOOT_TIMEOUT_MS);

    // El empleado creado se queda (activo) en la copia: `findDevOwnerAndEmployee`
    // elige siempre el más antiguo. Borrarlo (soft-delete) dejaría horarios sin
    // usuario visible y rompería `user-secrets` sobre la misma copia.
    afterAll(async () => {
      jest.restoreAllMocks();
      await close?.();
    });

    it('el alta (como la envía la app) crea el empleado INACTIVO y sin verificar, con horario y servicios', async () => {
      const res = await http
        .post('/api/auth/register/employee')
        .set(auth(ownerToken))
        .send({
          name: 'Prueba',
          lastname: 'Inactiva',
          email,
          phone,
          password: 'Clave123!',
          schedule: {
            monday: { start: '09:00', end: '18:00' },
            tuesday: { start: '09:00', end: '18:00' },
          },
          services: [{ serviceId: service.id, commissionPercentage: 10 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        isActive: false,
        is_email_verified: false,
      });
      employeeId = res.body.user.id;

      const row = await employeeRow();
      expect(row.isActive).toBe(false);
      expect(row.is_email_verified).toBe(false);
      expect(row.tenant_id).toBe(owner.id);
      expect(
        await ds
          .getRepository(Schedule)
          .count({ where: { user: { id: employeeId } } }),
      ).toBe(2);
      expect(
        await ds
          .getRepository(UserService)
          .count({ where: { userId: employeeId } }),
      ).toBe(1);
    });

    it('inactivo: aparece en la lista del Owner y se puede seguir configurando', async () => {
      const list = await http.get('/api/auth/employees').set(auth(ownerToken));
      expect(list.status).toBe(200);
      expect(list.body.find((e) => e.id === employeeId)).toMatchObject({
        isActive: false,
        is_email_verified: false,
      });

      const edit = await http
        .patch(`/api/auth/employee/${employeeId}`)
        .set(auth(ownerToken))
        .send({
          schedule: {
            monday: { start: '09:00', end: '18:00' },
            tuesday: { start: '09:00', end: '18:00' },
            wednesday: { start: '09:00', end: '18:00' },
          },
        });
      expect(edit.status).toBe(200);

      // La app configura horarios y servicios con esta misma ruta (no usa
      // `POST /schedules`, que da 500 a todos por un bug previo: 2.08).
      expect(
        await ds
          .getRepository(Schedule)
          .count({ where: { user: { id: employeeId } } }),
      ).toBe(3);
      expect((await employeeRow()).isActive).toBe(false);
    });

    it('inactivo: no se activa a mano (EMAIL_NOT_VERIFIED) ni recibe citas (PROFESSIONAL_INACTIVE)', async () => {
      const toggle = await http
        .patch(`/api/auth/employee/${employeeId}/status`)
        .set(auth(ownerToken))
        .send({ isActive: true });
      expect(toggle.status).toBe(409);
      expect(toggle.body.code).toBe('EMAIL_NOT_VERIFIED');

      const res = await book();
      expect(res.status).toBe(409); // §3 (2.34; antes 400, D-11)
      expect(res.body.code).toBe('PROFESSIONAL_INACTIVE');
      expect((await employeeRow()).isActive).toBe(false);
    });

    it('código incorrecto: 400 INVALID_VERIFICATION_CODE (antes 401) y sigue inactivo (2.33)', async () => {
      const res = await http
        .post('/api/auth/verify/employee-email')
        .set(auth(ownerToken))
        .send({ employee_id: employeeId, code: '000000' });
      expect([res.status, res.body.code]).toEqual([
        400,
        'INVALID_VERIFICATION_CODE',
      ]);
      expect((await employeeRow()).isActive).toBe(false);
    });

    it('pedir el código y verificar (con la sesión del Owner) lo deja activo y agendable', async () => {
      const request = await http
        .post('/api/auth/verify/request-code')
        .send({ email });
      expect(request.status).toBe(201);
      expect(EmailService.prototype.sendVerificationCode).toHaveBeenCalledWith(
        email,
        expect.any(String),
      );
      const [{ code }] = await ds.query(
        'SELECT verification_code AS code FROM users WHERE id = $1',
        [employeeId],
      );
      expect(code).toMatch(/^\d{6}$/);

      const verify = await http
        .post('/api/auth/verify/employee-email')
        .set(auth(ownerToken))
        .send({ employee_id: employeeId, code });
      expect(verify.status).toBe(201);
      expect(verify.body.is_verified).toBe(true);

      const row = await employeeRow();
      expect(row.isActive).toBe(true);
      expect(row.is_email_verified).toBe(true);

      const res = await book();
      expect(res.status).toBe(201);
    });

    /** Pide el código para `address` y lo verifica con la sesión del Owner. */
    const verifyEmployee = async (address: string) => {
      await http
        .post('/api/auth/verify/request-code')
        .send({ email: address })
        .expect(201);
      const [{ code }] = await ds.query(
        'SELECT verification_code AS code FROM users WHERE id = $1',
        [employeeId],
      );
      await http
        .post('/api/auth/verify/employee-email')
        .set(auth(ownerToken))
        .send({ employee_id: employeeId, code })
        .expect(201);
    };
    const activeIds = async () => {
      const res = await http
        .get('/api/auth/employees/active')
        .set(auth(ownerToken));
      expect(res.status).toBe(200);
      return (res.body as { id: string }[]).map((u) => u.id);
    };

    it('employees/active = los agendables: el empleado verificado y activo sí (2.33)', async () => {
      const ids = await activeIds();
      expect(ids).toContain(employeeId);
      expect(ids).toContain(owner.id);
    });

    it('cambiar el email del empleado exige verificarlo de nuevo: queda inactivo, fuera de active y sin citas (2.33)', async () => {
      const newEmail = `e2e.233.${suffix}@agendity.test`;
      const res = await http
        .patch(`/api/auth/employee/${employeeId}`)
        .set(auth(ownerToken))
        .send({ email: newEmail });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: newEmail,
        isActive: false,
        is_email_verified: false,
      });
      expect(await activeIds()).not.toContain(employeeId);
      const booking = await book();
      expect(booking.body.code).toBe('PROFESSIONAL_INACTIVE');

      // Verificar el email nuevo lo deja como estaba (activo y agendable).
      await verifyEmployee(newEmail);
      const row = await employeeRow();
      expect([row.isActive, row.is_email_verified]).toEqual([true, true]);
      expect(await activeIds()).toContain(employeeId);
    });

    it('borrar al dueño: 409 OWNER_NOT_DELETABLE (antes 404) (2.33)', async () => {
      const res = await http
        .delete(`/api/auth/employee/${owner.id}`)
        .set(auth(ownerToken));
      expect([res.status, res.body.code]).toEqual([409, 'OWNER_NOT_DELETABLE']);
    });

    it('borrar dos veces el mismo empleado: la segunda, 409 CONFLICT "ya eliminado" (antes 404) (2.33)', async () => {
      const extra = String(Date.now()).slice(-9);
      const created = await http
        .post('/api/auth/register/employee')
        .set(auth(ownerToken))
        .send({
          name: 'Prueba',
          lastname: 'Borrada',
          email: `e2e.233b.${extra}@agendity.test`,
          phone: `3${extra}`,
          password: 'Clave123!',
        });
      expect(created.status).toBe(201);
      const id = created.body.user.id;
      await http
        .delete(`/api/auth/employee/${id}`)
        .set(auth(ownerToken))
        .expect(200);
      const again = await http
        .delete(`/api/auth/employee/${id}`)
        .set(auth(ownerToken));
      expect([again.status, again.body.code, again.body.message]).toEqual([
        409,
        'CONFLICT',
        'El empleado ya ha sido eliminado previamente',
      ]);
    });
  },
);
