/**
 * Fase 8 (backend): nombre del negocio (8.00), horario del negocio (8.01) y
 * comisiones (8.02). Escribe: solo contra una copia
 * (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`), con el Owner y el empleado de
 * dev (horario L-V 09-18, hace "Depilación de cejas").
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { TenantSettingsService } from '../src/settings/tenant-settings.service';
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

describeWritable(
  'Fase 8: negocio, horario y comisiones (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    let owner: User;
    let employee: User;
    let ownerToken: string;
    let employeeToken: string;
    let client: Client;
    let serviceId: string;
    let servicePrice: number;
    let monday: string; // YYYY-MM-DD de un lunes libre a futuro
    const run = randomUUID().slice(0, 8);

    const book = (date: string) =>
      http
        .post('/api/appointments')
        .set(auth(ownerToken))
        .send({
          client_id: client.id,
          professional_id: employee.id,
          service_ids: [serviceId],
          date,
        });

    beforeAll(async () => {
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      const dev = await findDevOwnerAndEmployee(ds);
      owner = dev.owner;
      employee = dev.employee as User;
      ownerToken = signToken(owner, ['Owner']);
      employeeToken = signToken(employee, ['Employee']);
      client = await ds
        .getRepository(Client)
        .findOneOrFail({ where: { ownerId: owner.id } });
      const [row] = await ds.query(
        `SELECT s.id, s.price FROM services s
         JOIN user_services us ON us.service_id = s.id
        WHERE us.user_id = $1 AND us."isActive" AND s."isActive"
        ORDER BY s.name LIMIT 1`,
        [employee.id],
      );
      serviceId = row.id;
      servicePrice = Number(row.price);
      await resetTrialQuota(ds, owner.id, { limit: 1000 });
      monday = new Date(futureMonday(await firstFreeWeek(ds)))
        .toISOString()
        .slice(0, 10);
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      // Sin horario del negocio para los demás specs de la corrida.
      await ds.query(
        'UPDATE business_settings SET opening_hours = NULL WHERE tenant_id = $1',
        [owner.id],
      );
      app.get(TenantSettingsService).clearCache();
      jest.restoreAllMocks();
      await close();
    });

    it('8.00: el alta acepta el nombre del negocio; /settings y /auth/me lo devuelven, con slug estable', async () => {
      const name = `Estudio Cejas & Pestañas ${run}`;
      const reg = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Salón',
        email: `phase8-${run}@example.com`,
        phone: `3${Date.now().toString().slice(-9)}`,
        password: 'Secreta1!',
        business_name: name,
      });
      expect(reg.status).toBe(201);
      const token = reg.body.token;
      const settings = await http.get('/api/settings').set(auth(token));
      expect(settings.body).toMatchObject({
        name,
        slug: `estudio-cejas-pestanas-${run}`,
        opening_hours: null,
      });
      const me = await http.get('/api/auth/me').set(auth(token));
      expect(me.body.business_name).toBe(name);

      const renamed = await http
        .patch('/api/settings')
        .set(auth(token))
        .send({ name: 'Otro nombre' });
      expect(renamed.body).toMatchObject({
        name: 'Otro nombre',
        slug: `estudio-cejas-pestanas-${run}`,
      });
      const tooShort = await http
        .patch('/api/settings')
        .set(auth(token))
        .send({ name: 'x' });
      expect([tooShort.status, tooShort.body.code]).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
    });

    it('8.01: con horario del negocio 09-12, una cita a las 13:00 es OUTSIDE_BUSINESS_HOURS y las horas libres son la intersección', async () => {
      const hours = [1, 2, 3, 4, 5].map((day) => ({
        day_of_week: day,
        start_time: '09:00',
        end_time: '12:00',
      }));
      const patch = await http
        .patch('/api/settings')
        .set(auth(ownerToken))
        .send({ opening_hours: hours });
      expect(patch.status).toBe(200);
      expect(patch.body.opening_hours).toEqual(hours);

      const late = await book(`${monday}T13:00:00`);
      expect([late.status, late.body.code]).toEqual([
        409,
        'OUTSIDE_BUSINESS_HOURS',
      ]);
      const ok = await book(`${monday}T10:00:00`);
      expect(ok.status).toBe(201);

      const slots = await http
        .get(
          `/api/appointments/available-slots?professional_id=${employee.id}` +
            `&date=${monday}&service_ids=${serviceId}&step=60`,
        )
        .set(auth(ownerToken));
      expect(slots.status).toBe(200);
      expect((slots.body as string[]).map((d) => d.slice(11, 16))).toEqual([
        '09:00',
        '11:00',
      ]);

      // El Employee no puede cambiar el horario del negocio.
      const denied = await http
        .patch('/api/settings')
        .set(auth(employeeToken))
        .send({ opening_hours: null });
      expect(denied.status).toBe(403);
      // Quitarlo (null) vuelve a "sin límite".
      const cleared = await http
        .patch('/api/settings')
        .set(auth(ownerToken))
        .send({ opening_hours: null });
      expect(cleared.body.opening_hours).toBeNull();
      expect((await book(`${monday}T13:00:00`)).status).toBe(201);
    });

    it('8.02: comisión general del empleado congelada en la cita y liquidación de las COMPLETED', async () => {
      const set = await http
        .patch(`/api/auth/employee/${employee.id}`)
        .set(auth(ownerToken))
        .send({ commission_percentage: 40 });
      expect(set.status).toBe(200);
      // Sin excepción para su servicio: manda la general.
      await ds.query(
        `UPDATE user_services SET "commissionPercentage" = NULL
        WHERE user_id = $1 AND service_id = $2`,
        [employee.id, serviceId],
      );

      const booked = await book(`${monday}T15:00:00`);
      expect(booked.status).toBe(201);
      const [line] = await ds.query(
        `SELECT commission_percentage FROM appointment_services WHERE appointment_id = $1`,
        [booked.body.id],
      );
      expect(Number(line.commission_percentage)).toBe(40);

      // Cambiar después la comisión no toca la cita ya creada.
      await http
        .patch(`/api/auth/employee/${employee.id}`)
        .set(auth(ownerToken))
        .send({ commission_percentage: 10 });

      // Completar exige que haya empezado (7.03): se adelanta en la copia.
      await ds.query(
        `UPDATE appointments SET date = now() - interval '1 hour' WHERE id = $1`,
        [booked.body.id],
      );
      const done = await http
        .patch(`/api/appointments/${booked.body.id}/complete`)
        .set(auth(ownerToken));
      expect(done.status).toBe(200);

      const day = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
      const url = (extra = '') =>
        `/api/payments/stats/commissions?startDate=${day(-1)}&endDate=${day(1)}${extra}`;

      const asOwner = await http.get(url()).set(auth(ownerToken));
      expect(asOwner.status).toBe(200);
      const pro = asOwner.body.professionals.find(
        (p: { professional_id: string }) => p.professional_id === employee.id,
      );
      const appointment = pro.appointments.find(
        (a: { appointment_id: string }) => a.appointment_id === booked.body.id,
      );
      expect(appointment.services_total).toBe(servicePrice);
      expect(appointment.professional_total).toBeCloseTo(servicePrice * 0.4, 2);
      expect(
        appointment.professional_total + appointment.business_total,
      ).toBeCloseTo(servicePrice, 2);
      expect(appointment.lines[0].commission_percentage).toBe(40);

      const asEmployee = await http.get(url()).set(auth(employeeToken));
      expect(asEmployee.status).toBe(200);
      expect(
        asEmployee.body.professionals.every(
          (p: { professional_id: string }) => p.professional_id === employee.id,
        ),
      ).toBe(true);
      const other = await http
        .get(url(`&professionalId=${owner.id}`))
        .set(auth(employeeToken));
      expect([other.status, other.body.code]).toEqual([403, 'FORBIDDEN']);
    });
  },
);
