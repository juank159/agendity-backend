/**
 * Tarea 2.09a: recordatorios sin depender del proveedor.
 *
 * - Bloque de solo lectura (corre siempre, contra la BD del `.env`): escrituras
 *   de TypeORM bloqueadas con espías; `check-reminders` solo para el Owner y
 *   solo de su negocio.
 * - Bloque que escribe (solo con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`):
 *   el cron (llamado con un "ahora" fijo), su idempotencia y los recordatorios
 *   manuales de Owner y Employee.
 *
 * Nunca se envía nada real: `NODE_ENV=test` apaga el cron y CallMeBot/axios
 * están espiados para fallar si alguien los llama.
 */
import { INestApplication } from '@nestjs/common';
import axios from 'axios';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Service } from '../src/services/entities/service.entity';
import { Appointment } from '../src/appointments/entities/appointment.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { AppointmentReminderService } from '../src/appointments/appointment-reminder.service';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { AppointmentStatus } from '../src/common/enums/status.enum';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import {
  allowFictitiousAccounts,
  findDevOwnerAndEmployee,
  signToken,
} from './utils/dev-fixtures';
import {
  assertWritableDatabase,
  describeWritable,
  firstFreeWeek,
  futureMonday,
} from './utils/writable-db';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const STRANGER_ID = '55555555-5555-4555-8555-555555555555';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Las filas de prueba viven en [1990, 1995): pasado lejano, fuera de otros specs. */
const PAST_BASE = Date.UTC(1990, 0, 1, 15);
const PAST_LIMIT = Date.UTC(1995, 0, 1);

/** Ningún envío real: CallMeBot y axios fallan si se llaman. */
function forbidRealSends(app: INestApplication, sent: string[]) {
  const whatsapp = app.get(WhatsappService);
  for (const method of ['sendWhatsAppMessage', 'sendToOwner'] as const) {
    jest.spyOn(whatsapp, method).mockImplementation(async () => {
      sent.push(method);
      throw new Error('Envío real bloqueado en tests');
    });
  }
  jest.spyOn(axios, 'get').mockImplementation(async (url: string) => {
    sent.push(`axios ${url.slice(0, 30)}`);
    throw new Error('HTTP saliente bloqueado en tests');
  });
}

describe('Recordatorios 2.09a (e2e, solo lectura)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let employee: User | null;
  const writes: string[] = [];
  const sent: string[] = [];

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ({ employee } = await findDevOwnerAndEmployee(app.get(DataSource)));
    allowFictitiousAccounts(app, [STRANGER_ID]);
  });

  beforeEach(() => {
    writes.length = 0;
    sent.length = 0;
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
      ['save', 'insert', 'update', 'remove', 'delete', 'transaction'],
      'EntityManager',
    );
    forbidRealSends(app, sent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(writes).toEqual([]);
    expect(sent).toEqual([]);
  });

  afterAll(async () => {
    await close();
  });

  it('el cron no corre en los tests (NODE_ENV=test)', async () => {
    const process = jest.spyOn(
      app.get(AppointmentReminderService),
      'processDueReminders',
    );
    await app.get(AppointmentReminderService).runDueReminders();
    expect(process).not.toHaveBeenCalled();
  });

  it('check-reminders: el Owner solo dispara los de su negocio', async () => {
    // Mockeado: la consulta real se prueba en la copia (bloque que escribe).
    const spy = jest
      .spyOn(app.get(AppointmentReminderService), 'processDueReminders')
      .mockResolvedValue({ checked: 0, processed: [] });
    const res = await http
      .get('/api/appointments/check-reminders')
      .set(
        auth(
          signToken({ id: STRANGER_ID, name: 'x', email: 'x@x.x' }, ['Owner']),
        ),
      );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'Reminder check completed',
      processed: 0,
    });
    expect(spy.mock.calls[0][1]).toBe(STRANGER_ID);
  });

  it('check-reminders: un Employee recibe 403', async () => {
    if (!employee) return;
    const res = await http
      .get('/api/appointments/check-reminders')
      .set(auth(signToken(employee, ['Employee'])));
    expect(res.status).toBe(403);
  });
});

describeWritable('Recordatorios 2.09a (e2e, escribe en copia)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let reminders: AppointmentReminderService;
  let owner: User;
  let employee: User;
  let ownerToken: string;
  let employeeToken: string;
  let client: Client;
  let service: Service;
  /**
   * Instante de las citas de prueba: el día siguiente a la última fila de
   * corridas anteriores (1 día por corrida; antes avanzaba 1 día por FILA y
   * a las ~60 corridas sobre la misma copia salía de 1990).
   */
  let T: number;
  const sent: string[] = [];
  const ids: Record<string, string> = {};

  const insertAppointment = async (
    key: string,
    opts: {
      date: number;
      bookedAt: number;
      professional: User;
      status?: AppointmentStatus;
      sendReminder?: boolean;
    },
  ) => {
    const saved = await ds.getRepository(Appointment).save({
      ownerId: owner.id,
      professionalId: opts.professional.id,
      client: { id: client.id },
      services: [{ id: service.id }],
      date: new Date(opts.date),
      status: opts.status ?? AppointmentStatus.PENDING,
      total_price: 0,
      sendReminder: opts.sendReminder ?? true,
    } as Partial<Appointment>);
    await ds.query('UPDATE appointments SET created_at = $2 WHERE id = $1', [
      saved.id,
      new Date(opts.bookedAt),
    ]);
    ids[key] = saved.id;
  };

  const notificationsFor = (appointmentIds: string[]) =>
    ds
      .getRepository(Notification)
      .createQueryBuilder('n')
      .where(`n.metadata->>'appointment_id' IN (:...ids)`, {
        ids: appointmentIds,
      })
      .getMany();

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    await assertWritableDatabase(ds);
    reminders = app.get(AppointmentReminderService);
    const dev = await findDevOwnerAndEmployee(ds);
    owner = dev.owner;
    if (!dev.employee) throw new Error('La copia no tiene empleado');
    employee = dev.employee;
    ownerToken = signToken(owner, ['Owner']);
    employeeToken = signToken(employee, ['Employee']);
    client = await ds.getRepository(Client).findOneOrFail({
      where: { ownerId: owner.id },
      order: { id: 'ASC' },
    });
    service = await ds
      .getRepository(Service)
      .findOneOrFail({ where: { ownerId: owner.id }, order: { id: 'ASC' } });

    const [{ last }] = await ds.query(
      `SELECT max("date") AS last FROM appointments WHERE "date" < $1`,
      [new Date(PAST_LIMIT)],
    );
    T = last
      ? PAST_BASE +
        (Math.floor((new Date(last).getTime() - PAST_BASE) / DAY) + 1) * DAY
      : PAST_BASE;
    if (T + DAY >= PAST_LIMIT) {
      throw new Error('La copia agotó los días de prueba de 1990-1994');
    }
    const days3 = 3 * 24 * 60 * MINUTE;

    // Ahora = T − 50 min.
    await insertAppointment('ownerPending', {
      date: T,
      bookedAt: T - days3, // ≥ 24 h → ventana de 60: toca
      professional: owner,
    });
    await insertAppointment('employeeConfirmed', {
      date: T + 5 * MINUTE,
      bookedAt: T - days3,
      professional: employee,
      status: AppointmentStatus.CONFIRMED,
    });
    await insertAppointment('cancelled', {
      date: T + 10 * MINUTE,
      bookedAt: T - days3,
      professional: owner,
      status: AppointmentStatus.CANCELLED,
    });
    await insertAppointment('lateBooked', {
      date: T + 1,
      bookedAt: T - 60 * MINUTE, // < 2 h → ventana de 15: aún no
      professional: employee,
    });
    await insertAppointment('optedOut', {
      date: T + 20 * MINUTE,
      bookedAt: T - days3,
      professional: owner,
      sendReminder: false,
    });
    await insertAppointment('race', {
      date: T + 40 * MINUTE,
      bookedAt: T - days3,
      professional: employee,
    });
  });

  beforeEach(() => {
    sent.length = 0;
    forbidRealSends(app, sent);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    expect(sent).toEqual([]);
  });

  afterAll(async () => {
    await close();
  });

  it('otro negocio: no procesa las citas de este', async () => {
    const result = await reminders.processDueReminders(
      new Date(T - 50 * MINUTE),
      STRANGER_ID,
    );
    expect(result.processed).toEqual([]);
  });

  it('procesa PENDING y CONFIRMED en su ventana; no CANCELLED, ni fuera de ventana, ni send_reminder=false', async () => {
    const result = await reminders.processDueReminders(
      new Date(T - 50 * MINUTE),
      owner.id,
    );
    expect(result.processed.sort()).toEqual(
      [ids.ownerPending, ids.employeeConfirmed].sort(),
    );

    const notes = await notificationsFor(Object.values(ids));
    expect(notes).toHaveLength(2);
    const byAppointment = Object.fromEntries(
      notes.map((n) => [n.metadata.appointment_id, n]),
    );
    expect(byAppointment[ids.ownerPending].receiver_id).toBe(owner.id);
    expect(byAppointment[ids.employeeConfirmed].receiver_id).toBe(employee.id);
    expect(byAppointment[ids.ownerPending].type).toBe('APPOINTMENT_REMINDER');

    const [row] = await ds.query(
      `SELECT auto_reminder_for = "date" AS done, reminder_sent
         FROM appointments WHERE id = $1`,
      [ids.ownerPending],
    );
    // El automático no toca `reminder_sent` (es el manual al cliente).
    expect(row).toEqual({ done: true, reminder_sent: false });
  });

  it('idempotente: repetir la pasada (p. ej. tras reiniciar) no duplica', async () => {
    const result = await reminders.processDueReminders(
      new Date(T - 45 * MINUTE),
    );
    expect(result.processed).not.toContain(ids.ownerPending);
    expect(result.processed).not.toContain(ids.employeeConfirmed);
    expect(await notificationsFor([ids.ownerPending])).toHaveLength(1);
  });

  it('5 procesos que ven la misma cita a la vez → una sola notificación', async () => {
    // Lo que verían 5 instancias (o 5 pasadas solapadas) que leyeron la misma
    // candidata: solo el UPDATE condicional decide quién la procesa.
    const [candidate] = await ds.query(
      `SELECT id, "date", created_at AS "createdAt" FROM appointments WHERE id = $1`,
      [ids.race],
    );
    const claim = (reminders as any).claimAndNotify.bind(reminders);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        ds.transaction((manager) => claim(manager, candidate)),
      ),
    );
    const winners = results.filter((r) => r.status === 'fulfilled' && r.value);
    expect(winners).toHaveLength(1);
    expect(await notificationsFor([ids.race])).toHaveLength(1);

    const after = await reminders.processDueReminders(
      new Date(T - 15 * MINUTE),
    );
    expect(after.processed).not.toContain(ids.race);
  });

  it('la ventana corta (agendada con < 2 h) llega a los 15 min', async () => {
    const result = await reminders.processDueReminders(
      new Date(T - 14 * MINUTE),
    );
    expect(result.processed).toContain(ids.lateBooked);
  });

  it('si la cita se mueve, vuelve a tocar para la fecha nueva', async () => {
    await ds.query(`UPDATE appointments SET "date" = $2 WHERE id = $1`, [
      ids.ownerPending,
      new Date(T + 30 * MINUTE),
    ]);
    const result = await reminders.processDueReminders(
      new Date(T - 20 * MINUTE),
    );
    expect(result.processed).toContain(ids.ownerPending);
    expect(await notificationsFor([ids.ownerPending])).toHaveLength(2);
  });

  it('Employee: send-reminder de SU cita da teléfono (por la cita), texto y wa.me; no marca nada', async () => {
    const res = await http
      .post(`/api/appointments/${ids.employeeConfirmed}/send-reminder`)
      .set(auth(employeeToken));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      appointmentId: ids.employeeConfirmed,
      clientId: client.id,
      phone: client.phone,
    });
    expect(res.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    const [row] = await ds.query(
      'SELECT reminder_sent FROM appointments WHERE id = $1',
      [ids.employeeConfirmed],
    );
    expect(row.reminder_sent).toBe(false);
  });

  it('Employee: mark-sent de SU cita funciona y conserva la primera hora', async () => {
    const first = await http
      .patch(`/api/appointments/${ids.employeeConfirmed}/reminder/mark-sent`)
      .set(auth(employeeToken));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      appointmentId: ids.employeeConfirmed,
    });
    const second = await http
      .patch(`/api/appointments/${ids.employeeConfirmed}/reminder/mark-sent`)
      .set(auth(employeeToken));
    expect(second.status).toBe(200);
    expect(second.body.sentAt).toBe(first.body.sentAt);
    const [row] = await ds.query(
      'SELECT reminder_sent, status FROM appointments WHERE id = $1',
      [ids.employeeConfirmed],
    );
    expect(row).toEqual({ reminder_sent: true, status: 'CONFIRMED' });
  });

  it('Employee: citas de otro profesional → 404 en send-reminder y mark-sent', async () => {
    const send = await http
      .post(`/api/appointments/${ids.ownerPending}/send-reminder`)
      .set(auth(employeeToken));
    expect(send.status).toBe(404);
    const mark = await http
      .patch(`/api/appointments/${ids.ownerPending}/reminder/mark-sent`)
      .set(auth(employeeToken));
    expect(mark.status).toBe(404);
    const [row] = await ds.query(
      'SELECT reminder_sent FROM appointments WHERE id = $1',
      [ids.ownerPending],
    );
    expect(row.reminder_sent).toBe(false);
  });

  it('Owner: mark-sent de cualquier cita del negocio; send-reminder de una cancelada → 409 CONFLICT', async () => {
    const mark = await http
      .patch(`/api/appointments/${ids.lateBooked}/reminder/mark-sent`)
      .set(auth(ownerToken));
    expect(mark.status).toBe(200);
    const send = await http
      .post(`/api/appointments/${ids.cancelled}/send-reminder`)
      .set(auth(ownerToken));
    expect(send.status).toBe(409);
    expect(send.body.code).toBe('CONFLICT');
  });

  it('las respuestas de citas no exponen la marca interna del cron', async () => {
    const res = await http
      .get(`/api/appointments/${ids.ownerPending}`)
      .set(auth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('autoReminderFor');
    expect(res.body).toHaveProperty('reminderSent');
  });

  it('2.18: mover la cita a otra fecha reinicia el recordatorio manual; otros cambios no', async () => {
    const id = ids.ownerPending;
    const reminderOf = async () =>
      (
        await ds.query(
          'SELECT reminder_sent, reminder_sent_at FROM appointments WHERE id = $1',
          [id],
        )
      )[0];
    const markSent = async () => {
      const res = await http
        .patch(`/api/appointments/${id}/reminder/mark-sent`)
        .set(auth(ownerToken));
      expect(res.status).toBe(200);
      expect((await reminderOf()).reminder_sent).toBe(true);
    };
    const [{ date: originalDate }] = await ds.query(
      'SELECT date FROM appointments WHERE id = $1',
      [id],
    );
    await markSent();

    // 2.21: a otra hora PASADA no se puede mover (y no toca el recordatorio).
    const toPast = await http
      .patch(`/api/appointments/${id}`)
      .set(auth(ownerToken))
      .send({ date: new Date(T + 6 * 60 * MINUTE).toISOString() });
    expect([toPast.status, toPast.body.code]).toEqual([
      400,
      'APPOINTMENT_IN_PAST',
    ]);
    expect((await reminderOf()).reminder_sent).toBe(true);

    // A futuro sí: semana libre de la copia, lunes 10:00 Bogotá.
    const newDate = new Date(
      futureMonday(await firstFreeWeek(ds)) + 15 * 60 * MINUTE,
    );
    const moved = await http
      .patch(`/api/appointments/${id}`)
      .set(auth(ownerToken))
      .send({ date: newDate.toISOString() });
    expect(moved.status).toBe(200);
    expect(moved.body.reminderSent).toBe(false);
    expect(await reminderOf()).toEqual({
      reminder_sent: false,
      reminder_sent_at: null,
    });

    await markSent();
    const notes = await http
      .patch(`/api/appointments/${id}`)
      .set(auth(ownerToken))
      .send({ notes: 'solo notas 2.18' });
    expect(notes.status).toBe(200);
    expect((await reminderOf()).reminder_sent).toBe(true);

    // Mismo instante con otro formato (hora del negocio con offset): no reinicia.
    const sameInstant = await http
      .patch(`/api/appointments/${id}`)
      .set(auth(ownerToken))
      .send({ date: moved.body.date });
    expect(sameInstant.status).toBe(200);
    expect(moved.body.date).not.toBe(newDate.toISOString());
    expect((await reminderOf()).reminder_sent).toBe(true);

    // Vuelve a su fecha original (por SQL: la API ya no mueve al pasado) para el resto del spec.
    await ds.query('UPDATE appointments SET date = $2 WHERE id = $1', [
      id,
      originalDate,
    ]);
  });

  it('las filas de prueba quedan antes de 1995 (no afectan a otros specs)', async () => {
    const rows = await ds.getRepository(Appointment).find({
      where: { id: In(Object.values(ids)) },
    });
    expect(rows.every((r) => r.date.getTime() < PAST_LIMIT)).toBe(true);
  });
});
