import {
  AppointmentReminderService,
  isReminderDue,
  isReminderStatus,
  manualReminderResetOnReschedule,
  ownerWhatsappEnabled,
  reminderMessage,
  remindersCronEnabled,
  staffReminderMessage,
} from './appointment-reminder.service';
import { AppointmentStatus } from '../common/enums/status.enum';
import { toWhatsappPhone, whatsappLink } from '../whatsapp/whatsapp-phone';
import { BusinessException } from '../common/exceptions/business.exception';
import { NotFoundException } from '@nestjs/common';

const BOGOTA = 'America/Bogota';

/** Instantes explícitos con offset: los tests no dependen de la zona del proceso (correr también con TZ=UTC). */
const at = (iso: string) => new Date(iso);
const START = at('2026-10-21T08:00:00.000-05:00');

describe('isReminderDue (ventanas 60/30/15)', () => {
  const cases: Array<[string, string, string, boolean]> = [
    // [agendada en, ahora, descripción, ¿toca?]
    [
      '2026-10-19T08:00:00-05:00',
      '2026-10-21T06:59:00-05:00',
      '≥24 h: 1 min antes de la ventana de 60',
      false,
    ],
    [
      '2026-10-19T08:00:00-05:00',
      '2026-10-21T07:00:00-05:00',
      '≥24 h: abre a las 07:00',
      true,
    ],
    [
      '2026-10-19T08:00:00-05:00',
      '2026-10-21T07:59:59-05:00',
      '≥24 h: último segundo antes de la cita',
      true,
    ],
    [
      '2026-10-21T05:00:00-05:00',
      '2026-10-21T07:29:00-05:00',
      '≥2 h: antes de la ventana de 30',
      false,
    ],
    [
      '2026-10-21T05:00:00-05:00',
      '2026-10-21T07:30:00-05:00',
      '≥2 h: abre a las 07:30',
      true,
    ],
    [
      '2026-10-21T07:00:00-05:00',
      '2026-10-21T07:44:00-05:00',
      '<2 h: antes de la ventana de 15',
      false,
    ],
    [
      '2026-10-21T07:00:00-05:00',
      '2026-10-21T07:45:00-05:00',
      '<2 h: abre a las 07:45',
      true,
    ],
    [
      '2026-10-21T07:55:00-05:00',
      '2026-10-21T07:56:00-05:00',
      'agendada a 5 min: toca ya',
      true,
    ],
    [
      '2026-10-19T08:00:00-05:00',
      '2026-10-21T08:00:00-05:00',
      'la cita ya empezó',
      false,
    ],
    [
      '2026-10-19T08:00:00-05:00',
      '2026-10-21T09:00:00-05:00',
      'la cita ya pasó',
      false,
    ],
  ];

  it.each(cases)('agendada %s, ahora %s: %s', (booked, now, _label, due) => {
    expect(isReminderDue({ date: START, createdAt: at(booked) }, at(now))).toBe(
      due,
    );
  });

  it('servidor caído al abrirse la ventana: se envía al volver si la cita no empezó (sin pérdida)', () => {
    const booked = at('2026-10-01T10:00:00-05:00');
    expect(
      isReminderDue(
        { date: START, createdAt: booked },
        at('2026-10-21T07:40:00-05:00'),
      ),
    ).toBe(true);
  });

  it('createdAt posterior a "ahora" (reloj desfasado) no adelanta la ventana', () => {
    const now = at('2026-10-21T06:00:00-05:00');
    expect(
      isReminderDue(
        { date: START, createdAt: at('2026-10-21T07:59:00-05:00') },
        now,
      ),
    ).toBe(false);
  });
});

describe('manualReminderResetOnReschedule (2.18)', () => {
  it('otra fecha → reinicia; mismo instante o sin fecha → nada', () => {
    expect(
      manualReminderResetOnReschedule(START, at('2026-10-22T08:00:00-05:00')),
    ).toEqual({ reminderSent: false, reminderSentAt: null });
    expect(
      manualReminderResetOnReschedule(START, at('2026-10-21T13:00:00.000Z')),
    ).toBeNull();
    expect(manualReminderResetOnReschedule(START, undefined)).toBeNull();
  });
});

describe('estados y flags', () => {
  it('solo PENDING y CONFIRMED reciben recordatorio', () => {
    expect(isReminderStatus(AppointmentStatus.PENDING)).toBe(true);
    expect(isReminderStatus(AppointmentStatus.CONFIRMED)).toBe(true);
    expect(isReminderStatus(AppointmentStatus.COMPLETED)).toBe(false);
    expect(isReminderStatus(AppointmentStatus.CANCELLED)).toBe(false);
  });

  it('el cron no corre en tests ni con REMINDERS_CRON_ENABLED=false', () => {
    expect(remindersCronEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(
      remindersCronEnabled({
        NODE_ENV: 'production',
        REMINDERS_CRON_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(remindersCronEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(remindersCronEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  it('el aviso por CallMeBot al Owner está apagado por defecto', () => {
    expect(ownerWhatsappEnabled({})).toBe(false);
    expect(ownerWhatsappEnabled({ REMINDER_OWNER_WHATSAPP: '1' })).toBe(false);
    expect(ownerWhatsappEnabled({ REMINDER_OWNER_WHATSAPP: 'true' })).toBe(
      true,
    );
  });
});

describe('textos en la zona del negocio', () => {
  const appointment = {
    id: 'a1',
    date: START,
    services: [{ name: 'Corte' }, { name: 'Barba' }],
    client: { id: 'c1', name: 'Ana', lastname: 'Pérez' },
    reminderSent: false,
  } as any;

  it('al cliente: saludo con su nombre, día y hora de Bogotá', () => {
    const message = reminderMessage(appointment, BOGOTA);
    expect(message).toContain('Hola Ana,');
    expect(message).toContain('*Corte, Barba*');
    expect(message).toContain('*miércoles 21 de octubre*');
    expect(message).toContain('*8:00 AM*');
  });

  it('al profesional: avisa si aún no se envió el WhatsApp al cliente', () => {
    expect(staffReminderMessage(appointment, BOGOTA)).toContain('Ana Pérez');
    expect(staffReminderMessage(appointment, BOGOTA)).toContain('8:00 AM');
    expect(staffReminderMessage(appointment, BOGOTA)).toContain('Aún no');
    expect(
      staffReminderMessage({ ...appointment, reminderSent: true }, BOGOTA),
    ).not.toContain('Aún no');
  });
});

describe('textos de recordatorio en la zona de CADA negocio (6.02)', () => {
  // La misma cita (13:00Z) es a las 8:00 en Bogotá y a las 9:00 en Caracas.
  const appointment = {
    date: new Date('2026-10-21T13:00:00Z'),
    serviceLines: [],
    client: { id: 'c1', name: 'Ana', lastname: 'Pérez' },
    reminderSent: true,
  } as any;

  it('Bogotá 8:00 AM, Caracas 9:00 AM; y el día cambia con la zona', () => {
    expect(reminderMessage(appointment, BOGOTA)).toContain('*8:00 AM*');
    expect(reminderMessage(appointment, 'America/Caracas')).toContain(
      '*9:00 AM*',
    );
    const lateNight = {
      ...appointment,
      date: new Date('2026-10-22T04:30:00Z'),
    };
    expect(staffReminderMessage(lateNight, BOGOTA)).toContain(
      'el miércoles 21 de octubre a las 11:30 PM',
    );
    expect(staffReminderMessage(lateNight, 'America/Caracas')).toContain(
      'el jueves 22 de octubre a las 12:30 AM',
    );
  });
});

describe('toWhatsappPhone / whatsappLink', () => {
  it.each([
    ['3001234567', undefined, '573001234567'],
    ['300 123 4567', undefined, '573001234567'],
    ['+57 300-123-4567', undefined, '573001234567'],
    ['573001234567', undefined, '573001234567'],
    ['(300) 123-4567', '+1', '13001234567'],
    ['+34612345678', '+57', '34612345678'],
    ['12345', undefined, '12345'],
  ])('%s (%s) → %s', (phone, country, expected) => {
    expect(toWhatsappPhone(phone, country)).toBe(expected);
  });

  it('el enlace lleva el texto codificado', () => {
    expect(whatsappLink('3001234567', 'Hola & adiós')).toBe(
      'https://wa.me/573001234567?text=Hola%20%26%20adi%C3%B3s',
    );
  });
});

describe('AppointmentReminderService.processDueReminders', () => {
  const NOW = at('2026-10-21T07:50:00-05:00');
  const due = {
    id: 'due-1',
    timezone: BOGOTA,
    date: START,
    createdAt: at('2026-10-01T10:00:00-05:00'),
  };
  const notYet = {
    id: 'later-1',
    date: at('2026-10-21T08:45:00-05:00'),
    createdAt: at('2026-10-21T07:30:00-05:00'), // < 2 h → ventana de 15 (08:30)
  };
  const loaded = {
    id: 'due-1',
    ownerId: 'owner-1',
    professionalId: 'pro-1',
    date: START,
    reminderSent: false,
    client: { id: 'c1', name: 'Ana', lastname: 'Pérez', phone: '3001234567' },
    services: [{ name: 'Corte' }],
  };

  let repo: { query: jest.Mock; findOne: jest.Mock };
  let whatsapp: { sendToOwner: jest.Mock; sendWhatsAppMessage: jest.Mock };
  let execute: jest.Mock;
  let saved: any[];
  let qbWheres: string[];
  let service: AppointmentReminderService;
  const env = { ...process.env };

  beforeEach(() => {
    saved = [];
    qbWheres = [];
    execute = jest.fn().mockResolvedValue({ affected: 1 });
    const qb: any = {
      update: () => qb,
      set: () => qb,
      where: (w: string) => (qbWheres.push(w), qb),
      andWhere: (w: string) => (qbWheres.push(w), qb),
      execute,
    };
    const manager: any = {
      createQueryBuilder: () => qb,
      getRepository: (entity: { name: string }) =>
        entity.name === 'Appointment'
          ? { findOne: jest.fn().mockResolvedValue(loaded) }
          : {
              create: (x: any) => x,
              save: jest.fn(async (x: any) => (saved.push(x), x)),
            },
    };
    const dataSource: any = {
      transaction: jest.fn((fn: (m: any) => unknown) => fn(manager)),
    };
    repo = {
      query: jest.fn().mockResolvedValue([due, notYet]),
      findOne: jest.fn(),
    };
    whatsapp = {
      sendToOwner: jest.fn().mockResolvedValue({ success: true }),
      sendWhatsAppMessage: jest.fn(() => {
        throw new Error('nunca se envía al cliente');
      }),
    };
    service = new AppointmentReminderService(
      repo as any,
      dataSource,
      whatsapp as any,
    );
    delete process.env.REMINDER_OWNER_WHATSAPP;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('procesa solo las citas en su ventana y deja una notificación al profesional', async () => {
    const result = await service.processDueReminders(NOW);
    expect(result).toEqual({ checked: 2, processed: ['due-1'] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      receiver_id: 'pro-1',
      receiver_type: 'USER',
      type: 'APPOINTMENT_REMINDER',
      metadata: { appointment_id: 'due-1', client_id: 'c1' },
    });
    // Sin flag: nada de CallMeBot, y nunca al cliente.
    expect(whatsapp.sendToOwner).not.toHaveBeenCalled();
    expect(whatsapp.sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('cada cita usa SU zona guardada (6.03), aunque el negocio esté en otra', async () => {
    // 08:00 de Bogotá = 09:00 de Caracas: la cita se agendó en Caracas.
    repo.query.mockResolvedValue([{ ...due, timezone: 'America/Caracas' }]);
    await service.processDueReminders(NOW);
    const [sql] = repo.query.mock.calls[0];
    expect(sql).toContain('a.timezone');
    expect(saved).toHaveLength(1);
    expect(saved[0].message).toContain('a las 9:00 AM');
  });

  it('consulta PENDING y CONFIRMED de la próxima hora, sin las ya procesadas para su fecha', async () => {
    await service.processDueReminders(NOW);
    const [sql, params] = repo.query.mock.calls[0];
    expect(params[0]).toEqual(['PENDING', 'CONFIRMED']);
    expect(params[1]).toEqual(NOW);
    expect((params[2] as Date).getTime() - NOW.getTime()).toBe(60 * 60_000);
    expect(sql).toContain('auto_reminder_for IS DISTINCT FROM a."date"');
    expect(sql).toContain('a.send_reminder');
    // Todos los negocios (sin filtro de tenant); el owner_id solo se lee para la zona (6.02).
    expect(sql).not.toContain('a.owner_id = $4');
  });

  it('el UPDATE que reclama la cita es condicional (estado, fecha y no procesada)', async () => {
    await service.processDueReminders(NOW);
    expect(qbWheres.join(' ')).toContain('auto_reminder_for IS DISTINCT FROM');
    expect(qbWheres.join(' ')).toContain('status IN');
    expect(qbWheres.join(' ')).toContain('"date"');
  });

  it('idempotente: si otra pasada ya la reclamó (affected 0), no notifica otra vez', async () => {
    execute.mockResolvedValue({ affected: 0 });
    const result = await service.processDueReminders(NOW);
    expect(result.processed).toEqual([]);
    expect(saved).toHaveLength(0);
  });

  it('con tenant: filtra por owner_id', async () => {
    await service.processDueReminders(NOW, 'tenant-1');
    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toContain('a.owner_id = $4');
    expect(params[3]).toBe('tenant-1');
  });

  it('tenant vacío: lanza antes de consultar (nunca todos los negocios por error)', async () => {
    await expect(service.processDueReminders(NOW, '')).rejects.toThrow();
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('REMINDER_OWNER_WHATSAPP=true: avisa al Owner una vez; un fallo no rompe la pasada', async () => {
    process.env.REMINDER_OWNER_WHATSAPP = 'true';
    whatsapp.sendToOwner.mockRejectedValue(new Error('CallMeBot caído'));
    const result = await service.processDueReminders(NOW);
    expect(result.processed).toEqual(['due-1']);
    expect(whatsapp.sendToOwner).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendToOwner.mock.calls[0][0]).toBe('owner-1');
  });

  it('el cron no hace nada en tests (NODE_ENV=test)', async () => {
    process.env.NODE_ENV = 'test';
    await service.runDueReminders();
    expect(repo.query).not.toHaveBeenCalled();
  });

  it('el cron no solapa pasadas en el mismo proceso', async () => {
    process.env.NODE_ENV = 'production';
    let release: () => void = () => undefined;
    repo.query.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const first = service.runDueReminders();
    await service.runDueReminders();
    release();
    await first;
    expect(repo.query).toHaveBeenCalledTimes(1);
  });
});

describe('AppointmentReminderService.prepareManualReminder', () => {
  const base = {
    id: 'a1',
    timezone: BOGOTA,
    status: AppointmentStatus.CONFIRMED,
    date: START,
    services: [{ name: 'Corte' }],
    client: {
      id: 'c1',
      name: 'Ana',
      phone: '300 123 4567',
      countryCode: '+57',
    },
  };
  const make = (found: unknown) => {
    const repo = { findOne: jest.fn().mockResolvedValue(found) };
    const service = new AppointmentReminderService(
      repo as any,
      {} as any,
      {} as any,
    );
    return { repo, service };
  };

  it('el texto usa la zona guardada en la cita (6.03)', async () => {
    const { service } = make({ ...base, timezone: 'America/Caracas' });
    const result = await service.prepareManualReminder('a1', {
      tenantId: 't1',
    });
    expect(result.message).toContain('*9:00 AM*');
  });

  it('Employee: busca solo entre sus citas y devuelve teléfono por la relación de la cita', async () => {
    const { repo, service } = make(base);
    const result = await service.prepareManualReminder('a1', {
      tenantId: 't1',
      professionalId: 'e1',
    });
    expect(repo.findOne.mock.calls[0][0].where).toEqual({
      id: 'a1',
      ownerId: 't1',
      professionalId: 'e1',
    });
    expect(result).toMatchObject({
      appointmentId: 'a1',
      clientId: 'c1',
      phone: '300 123 4567',
    });
    expect(result.whatsappUrl).toMatch(
      /^https:\/\/wa\.me\/573001234567\?text=/,
    );
  });

  it('cita ajena o inexistente → 404', async () => {
    const { service } = make(null);
    await expect(
      service.prepareManualReminder('a1', { tenantId: 't1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED])(
    'cita %s → CONFLICT',
    async (status) => {
      const { service } = make({ ...base, status });
      await expect(
        service.prepareManualReminder('a1', { tenantId: 't1' }),
      ).rejects.toBeInstanceOf(BusinessException);
    },
  );

  it('cliente sin teléfono → CONFLICT', async () => {
    const { service } = make({
      ...base,
      client: { ...base.client, phone: ' ' },
    });
    await expect(
      service.prepareManualReminder('a1', { tenantId: 't1' }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
