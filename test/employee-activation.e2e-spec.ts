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
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';
import {
  WRITABLE_DB,
  assertWritableDatabase,
  describeWritable,
  resetTrialQuota,
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

    /** Cita en el PASADO (sin recordatorios), un lunes distinto cada vez, 10:00. */
    const book = () => {
      day += 1;
      return http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: employeeId,
          service_ids: [service.id],
          date: new Date(Date.UTC(2000, 0, 3 + 7 * day, 15)).toISOString(),
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
      const [{ n }] = await ds.query(
        'SELECT count(*)::int AS n FROM appointments',
      );
      day = n;
    });

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
      expect(res.status).toBe(400); // HTTP legado (D-11)
      expect(res.body.code).toBe('PROFESSIONAL_INACTIVE');
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
  },
);
