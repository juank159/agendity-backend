import { NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AppointmentsService } from './appointments.service';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { AppointmentStatus } from 'src/common/enums/status.enum';
import { AppointmentServiceLine } from './entities/appointment-service-line.entity';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';
const CLIENT = 'c0000000-0000-4000-8000-000000000001';
const SERVICE = 'c0000000-0000-4000-8000-000000000002';

function build() {
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(async (a) => ({ id: 'nueva', ...a })),
  };
  const clients = { findOne: jest.fn().mockResolvedValue({ id: CLIENT }) };
  const users = {
    findTenantMember: jest
      .fn()
      .mockResolvedValue({ id: EMPLOYEE, isActive: true }),
  };
  const services = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: SERVICE, price: '10', duration: 30 }),
  };
  const events = { emit: jest.fn() };
  const subscriptions = {
    consumeAppointmentQuota: jest
      .fn()
      .mockResolvedValue({ canCreateAppointment: true }),
  };
  // Transacción simulada: la cita se guarda con el repositorio del manager.
  // `findOne` con lock (`lockAppointment`) devuelve lo mismo que el repositorio.
  const txRepo = {
    save: jest.fn(async (a) => ({ id: 'nueva', ...a })),
    findOne: jest.fn((options) => repo.findOne(options)),
    update: jest.fn(async () => ({ affected: 1 })),
    // ¿Tiene la cita un pago COMPLETED? (cancelar, 2.15)
    exist: jest.fn(async () => false),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
  // Lo que "hay" en la BD para el hueco: horarios, bloqueos y citas que se cruzan.
  const db = {
    schedules: [] as any[],
    blocks: [] as any[],
    overlaps: [] as any[],
  };
  const scheduleRepo = { find: jest.fn(async () => db.schedules) };
  // Servicios guardados de cada cita, con su precio (2.29).
  const lines: { appointmentId: string; serviceId: string; price: string }[] =
    [];
  const lineRepo = {
    find: jest.fn(async ({ where }) =>
      lines.filter((l) => l.appointmentId === where.appointmentId),
    ),
    delete: jest.fn(async ({ appointmentId, serviceId }) => {
      const ids: string[] = serviceId.value;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (
          lines[i].appointmentId === appointmentId &&
          ids.includes(lines[i].serviceId)
        ) {
          lines.splice(i, 1);
        }
      }
      return { affected: ids.length };
    }),
    insert: jest.fn(async (rows: typeof lines) => {
      lines.push(...rows);
      return {};
    }),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Schedule
        ? scheduleRepo
        : entity === AppointmentServiceLine
          ? lineRepo
          : txRepo,
    ),
    query: jest.fn<Promise<any[]>, [string, unknown[]?]>(async (sql) => {
      if (sql.includes('pg_advisory_xact_lock')) return [{}];
      if (sql.includes('FROM time_block')) return db.blocks;
      if (sql.includes('FROM appointments')) return db.overlaps;
      throw new Error(`SQL inesperado: ${sql}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
      work(manager),
    ),
    // Lecturas fuera de transacción (huecos libres, 2.14): el mismo manager simulado.
    manager,
  };
  const service = new AppointmentsService(
    repo as any,
    clients as any,
    users as any,
    services as any,
    events as any,
    subscriptions as any,
    dataSource as any,
  );
  return {
    service,
    repo,
    clients,
    users,
    services,
    subscriptions,
    txRepo,
    manager,
    dataSource,
    events,
    db,
    scheduleRepo,
    lines,
    lineRepo,
  };
}

/** Llamadas a `manager.query` cuyo SQL contiene `fragment`. */
function queriesWith(manager: any, fragment: string) {
  return manager.query.mock.calls.filter(([sql]) => sql.includes(fragment));
}

const dto = {
  client_id: CLIENT,
  professional_id: EMPLOYEE,
  service_ids: [SERVICE],
  date: '2030-01-01T10:00:00',
} as any;

describe('AppointmentsService (tenant)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('create valida cliente, profesional y servicios contra el tenant y guarda owner_id = tenant', async () => {
    const { service, repo, clients, users, services, subscriptions, txRepo } =
      build();
    await service.create(dto, TENANT);
    expect(clients.findOne).toHaveBeenCalledWith(CLIENT, TENANT);
    expect(users.findTenantMember).toHaveBeenCalledWith(EMPLOYEE, TENANT);
    expect(services.findOne).toHaveBeenCalledWith(SERVICE, TENANT);
    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: TENANT, professionalId: EMPLOYEE }),
    );
    expect(repo.save).not.toHaveBeenCalled(); // solo dentro de la transacción
    expect(subscriptions.consumeAppointmentQuota).toHaveBeenCalledTimes(1);
  });

  it('create consume el cupo DENTRO de la misma transacción que guarda la cita', async () => {
    const { service, subscriptions, txRepo, manager, dataSource, events } =
      build();
    await service.create(dto, TENANT);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(subscriptions.consumeAppointmentQuota).toHaveBeenCalledWith(
      TENANT,
      manager,
    );
    expect(
      subscriptions.consumeAppointmentQuota.mock.invocationCallOrder[0],
    ).toBeLessThan(txRepo.save.mock.invocationCallOrder[0]);
    expect(events.emit).toHaveBeenCalledWith(
      'appointment.created',
      expect.objectContaining({ id: 'nueva' }),
    );
  });

  it('trial agotado: el error del cupo sale tal cual (400 TRIAL_LIMIT_REACHED) y no se guarda', async () => {
    const { service, subscriptions, txRepo, manager, events } = build();
    subscriptions.consumeAppointmentQuota.mockRejectedValue(
      new BusinessException(
        ErrorCode.TRIAL_LIMIT_REACHED,
        'Has alcanzado el límite de citas de prueba. Por favor, adquiere un plan para continuar.',
        400,
      ),
    );
    const error = await service.create(dto, TENANT).catch((e) => e);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'TRIAL_LIMIT_REACHED' });
    expect(manager.query).not.toHaveBeenCalled(); // ni siquiera mira el hueco
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('si la cita no se puede crear después de consumir, la transacción falla (rollback del cupo)', async () => {
    const { service, txRepo, dataSource, events, db } = build();
    db.overlaps = [{ id: 'otra' }];
    const error = await service.create(dto, TENANT).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    // El error se lanzó dentro del callback: TypeORM hace ROLLBACK de todo,
    // incluido el +1 del trial.
    await expect(dataSource.transaction.mock.results[0].value).rejects.toBe(
      error,
    );
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('si falla el guardado, el error sale de la transacción y no se emite el evento', async () => {
    const { service, txRepo, dataSource, events } = build();
    txRepo.save.mockRejectedValue(new Error('fallo de BD'));
    await expect(service.create(dto, TENANT)).rejects.toThrow(
      'Error al crear la cita',
    );
    await expect(dataSource.transaction.mock.results[0].value).rejects.toThrow(
      'fallo de BD',
    );
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('create con un profesional de otro negocio: 404 sin tocar la suscripción ni guardar', async () => {
    const { service, repo, users, subscriptions } = build();
    users.findTenantMember.mockRejectedValue(
      new NotFoundException('Profesional no encontrado'),
    );
    await expect(service.create(dto, TENANT)).rejects.toThrow(
      NotFoundException,
    );
    expect(subscriptions.consumeAppointmentQuota).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('findOne filtra por tenant y, para el Employee, por profesional', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValue({ id: 'x' });
    await service.findOne('x', TENANT);
    expect(repo.findOne.mock.calls[0][0].where).toEqual({
      id: 'x',
      ownerId: TENANT,
    });
    await service.findOne('x', { tenantId: TENANT, professionalId: EMPLOYEE });
    expect(repo.findOne.mock.calls[1][0].where).toEqual({
      id: 'x',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
    });
  });

  it('findOne sin tenant o de otro negocio: 404', async () => {
    const { service, repo } = build();
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('x', TENANT)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.findOne('x', undefined)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('AppointmentsService (disponibilidad, 2.04)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  const expectSlotUnavailable = (error: any) => {
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.getStatus()).toBe(400); // HTTP legado (D-11)
    expect(error.getResponse()).toMatchObject({
      code: 'SLOT_UNAVAILABLE',
      message: 'Horario no disponible', // la app compara este texto
    });
  };

  it('toma el lock del profesional dentro de la transacción, después del cupo y antes de leer', async () => {
    const { service, manager, subscriptions, txRepo } = build();
    await service.create(dto, TENANT);
    const calls = manager.query.mock.calls;
    expect(calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(calls[0][1]).toEqual([`appointment-slot:${EMPLOYEE}`]);
    expect(
      subscriptions.consumeAppointmentQuota.mock.invocationCallOrder[0],
    ).toBeLessThan(manager.query.mock.invocationCallOrder[0]);
    expect(manager.query.mock.invocationCallOrder.at(-1)).toBeLessThan(
      txRepo.save.mock.invocationCallOrder[0],
    );
  });

  it('las citas CANCELLED no bloquean: la consulta de cruces las excluye', async () => {
    const { service, manager } = build();
    await service.create(dto, TENANT);
    const [[sql, params]] = queriesWith(manager, 'FROM appointments');
    expect(sql).toContain('NOT (a.status = ANY($3');
    expect(params[2]).toEqual([AppointmentStatus.CANCELLED]);
    expect(params[0]).toBe(EMPLOYEE);
    expect(params[1]).toBe(TENANT);
    expect(params[5]).toBeNull(); // al crear no se excluye ninguna cita
  });

  it('cruce con otra cita: SLOT_UNAVAILABLE "Horario no disponible" y no guarda', async () => {
    const { service, db, txRepo } = build();
    db.overlaps = [{ id: 'otra' }];
    expectSlotUnavailable(await service.create(dto, TENANT).catch((e) => e));
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('fuera del horario del profesional: SLOT_UNAVAILABLE', async () => {
    const { service, db, txRepo, manager } = build();
    db.schedules = [
      {
        day_of_week: 2,
        start_time: '14:00:00',
        end_time: '18:00:00',
        is_available: true,
      },
    ];
    // 2030-01-01 es martes; 10:00 (hora de Bogotá, sin offset en el DTO) queda antes de las 14:00.
    expectSlotUnavailable(await service.create(dto, TENANT).catch((e) => e));
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(queriesWith(manager, 'FROM appointments')).toHaveLength(0);
  });

  it('dentro del horario del profesional: se guarda', async () => {
    const { service, db, txRepo } = build();
    db.schedules = [
      {
        day_of_week: 2,
        start_time: '09:00:00',
        end_time: '18:00:00',
        is_available: true,
      },
    ];
    await service.create(dto, TENANT);
    expect(txRepo.save).toHaveBeenCalledTimes(1);
  });

  it('bloqueo de tiempo del profesional: SLOT_UNAVAILABLE', async () => {
    const { service, db, txRepo, manager } = build();
    db.blocks = [{ '?column?': 1 }];
    expectSlotUnavailable(await service.create(dto, TENANT).catch((e) => e));
    expect(txRepo.save).not.toHaveBeenCalled();
    const [[, params]] = queriesWith(manager, 'FROM time_block');
    expect(params[0]).toBe(EMPLOYEE);
  });

  it('servicio sin duración: el hueco se calcula con 30 min', async () => {
    const { service, services, manager } = build();
    services.findOne.mockResolvedValue({
      id: SERVICE,
      price: '10',
      duration: null,
    });
    await service.create(dto, TENANT);
    const [[, params]] = queriesWith(manager, 'FROM appointments');
    const [start, end] = [params[4], params[3]];
    expect(start).toEqual(new Date('2030-01-01T10:00:00-05:00'));
    expect(end).toEqual(new Date('2030-01-01T10:30:00-05:00'));
  });

  it('profesional inactivo: PROFESSIONAL_INACTIVE sin tocar el cupo', async () => {
    const { service, users, subscriptions, txRepo } = build();
    users.findTenantMember.mockResolvedValue({ id: EMPLOYEE, isActive: false });
    const error = await service.create(dto, TENANT).catch((e) => e);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'PROFESSIONAL_INACTIVE',
    });
    expect(error.getResponse().message).not.toMatch(
      /horario no disponible|trial|plan de prueba|límite de citas/i,
    );
    expect(subscriptions.consumeAppointmentQuota).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('profesional borrado (soft-delete): 404 de findTenantMember, sin cupo', async () => {
    const { service, users, subscriptions } = build();
    users.findTenantMember.mockRejectedValue(new NotFoundException());
    await expect(service.create(dto, TENANT)).rejects.toThrow(
      NotFoundException,
    );
    expect(subscriptions.consumeAppointmentQuota).not.toHaveBeenCalled();
  });

  describe('update (mover o editar)', () => {
    const existing = () => ({
      id: 'cita-1',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
      date: new Date('2030-01-01T10:00:00-05:00'),
      status: AppointmentStatus.PENDING,
      services: [{ id: SERVICE, duration: 60 }],
    });

    it('mover la fecha: misma regla y lock, excluyendo la propia cita, en la transacción', async () => {
      const { service, repo, manager, txRepo, dataSource } = build();
      repo.findOne.mockResolvedValue(existing());
      await service.update(
        'cita-1',
        { date: '2030-01-01T15:00:00' } as any,
        TENANT,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(queriesWith(manager, 'pg_advisory_xact_lock')[0][1]).toEqual([
        `appointment-slot:${EMPLOYEE}`,
      ]);
      const [[, params]] = queriesWith(manager, 'FROM appointments');
      expect(params[5]).toBe('cita-1');
      expect(params[4]).toEqual(new Date('2030-01-01T15:00:00-05:00'));
      expect(params[3]).toEqual(new Date('2030-01-01T16:00:00-05:00')); // usa los servicios guardados
      const [[, blockParams]] = queriesWith(manager, 'FROM time_block');
      expect(blockParams[3]).toBe('cita-1');
      expect(txRepo.save).toHaveBeenCalledTimes(1);
      expect(repo.save).not.toHaveBeenCalled(); // nunca fuera de la transacción
    });

    it('mover a un hueco ocupado: SLOT_UNAVAILABLE y no guarda', async () => {
      const { service, repo, db, txRepo } = build();
      repo.findOne.mockResolvedValue(existing());
      db.overlaps = [{ id: 'otra' }];
      const error = await service
        .update('cita-1', { date: '2030-01-01T15:00:00' } as any, TENANT)
        .catch((e) => e);
      expectSlotUnavailable(error);
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('cambiar de profesional: lock y comprobación sobre el nuevo; inactivo → PROFESSIONAL_INACTIVE', async () => {
      const OTHER = 'c0000000-0000-4000-8000-000000000099';
      const { service, repo, users, manager, txRepo } = build();
      repo.findOne.mockResolvedValue(existing());
      users.findTenantMember.mockResolvedValue({ id: OTHER, isActive: true });
      await service.update('cita-1', { professional_id: OTHER } as any, TENANT);
      expect(queriesWith(manager, 'pg_advisory_xact_lock')[0][1]).toEqual([
        `appointment-slot:${OTHER}`,
      ]);
      expect(txRepo.save).toHaveBeenCalledTimes(1);

      users.findTenantMember.mockResolvedValue({ id: OTHER, isActive: false });
      const error = await service
        .update('cita-1', { professional_id: OTHER } as any, TENANT)
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        code: 'PROFESSIONAL_INACTIVE',
      });
    });

    it('solo notas o cancelar: no comprueba el hueco', async () => {
      const { service, repo, manager, txRepo } = build();
      repo.findOne.mockResolvedValue(existing());
      await service.update('cita-1', { notes: 'x' } as any, TENANT);
      await service.update(
        'cita-1',
        {
          date: '2030-01-01T15:00:00',
          status: AppointmentStatus.CANCELLED,
        } as any,
        TENANT,
      );
      expect(manager.query).not.toHaveBeenCalled();
      expect(txRepo.save).toHaveBeenCalledTimes(2);
    });

    it('reactivar una cita CANCELLED: INVALID_STATE_TRANSITION (409) sin comprobar el hueco ni guardar', async () => {
      const { service, repo, manager, txRepo } = build();
      repo.findOne.mockResolvedValue({
        ...existing(),
        status: AppointmentStatus.CANCELLED,
      });
      const error = await service
        .update('cita-1', { status: AppointmentStatus.PENDING } as any, TENANT)
        .catch((e) => e);
      expect(error).toBeInstanceOf(BusinessException);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(manager.query).not.toHaveBeenCalled();
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('el estado se valida contra la fila bloqueada (FOR UPDATE), no contra la lectura previa', async () => {
      const { service, repo, txRepo } = build();
      // Lectura previa: PENDING. Dentro de la transacción (con lock): ya CANCELLED.
      repo.findOne.mockResolvedValue(existing());
      txRepo.findOne.mockResolvedValueOnce({
        ...existing(),
        status: AppointmentStatus.CANCELLED,
      });
      const error = await service
        .update(
          'cita-1',
          { status: AppointmentStatus.CONFIRMED } as any,
          TENANT,
        )
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(txRepo.findOne.mock.calls[0][0]).toMatchObject({
        where: { id: 'cita-1', ownerId: TENANT },
        lock: { mode: 'pessimistic_write' },
      });
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('guarda solo los campos que cambian (no la foto vieja: estado, pago y recordatorio intactos)', async () => {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue({
        ...existing(),
        payment_status: 'PENDING',
        reminderSent: false,
      });
      await service.update('cita-1', { notes: 'nota' } as any, TENANT);
      expect(txRepo.save).toHaveBeenCalledWith({ id: 'cita-1', notes: 'nota' });
    });

    it('mover a otra fecha reinicia el recordatorio manual (2.18)', async () => {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue({
        ...existing(),
        reminderSent: true,
        reminderSentAt: new Date('2029-12-31T10:00:00-05:00'),
      });
      await service.update(
        'cita-1',
        { date: '2030-01-01T15:00:00' } as any,
        TENANT,
      );
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cita-1',
          date: new Date('2030-01-01T15:00:00-05:00'),
          reminderSent: false,
          reminderSentAt: null,
        }),
      );
    });

    it('la misma fecha (otro formato) u otros cambios no reinician el recordatorio (2.18)', async () => {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue({ ...existing(), reminderSent: true });
      await service.update(
        'cita-1',
        { date: '2030-01-01T15:00:00.000Z' } as any, // = 10:00 de Bogotá
        TENANT,
      );
      await service.update('cita-1', { notes: 'x' } as any, TENANT);
      await service.update(
        'cita-1',
        { professional_id: EMPLOYEE, service_ids: [SERVICE] } as any,
        TENANT,
      );
      for (const [saved] of txRepo.save.mock.calls) {
        expect(saved).not.toHaveProperty('reminderSent');
        expect(saved).not.toHaveProperty('reminderSentAt');
      }
      expect(txRepo.save).toHaveBeenCalledTimes(3);
    });

    it('compara con la fecha de la fila bloqueada, no con la lectura previa (2.18)', async () => {
      const { service, repo, txRepo } = build();
      const moved = new Date('2030-01-01T15:00:00-05:00');
      repo.findOne
        .mockResolvedValueOnce(existing()) // lectura previa: 10:00
        .mockResolvedValue({ ...existing(), date: moved }); // bajo el lock: ya 15:00
      await service.update(
        'cita-1',
        { date: '2030-01-01T15:00:00' } as any,
        TENANT,
      );
      expect(txRepo.save.mock.calls[0][0]).not.toHaveProperty('reminderSent');
    });

    it('cancelar por el PATCH guarda el motivo; el mismo estado es un no-op', async () => {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue(existing());
      await service.update(
        'cita-1',
        {
          status: AppointmentStatus.CANCELLED,
          cancellation_reason: 'lluvia',
        } as any,
        TENANT,
      );
      expect(txRepo.save).toHaveBeenLastCalledWith({
        id: 'cita-1',
        status: AppointmentStatus.CANCELLED,
        cancellation_reason: 'lluvia',
      });
      await service.update(
        'cita-1',
        { status: AppointmentStatus.PENDING } as any,
        TENANT,
      );
      expect(txRepo.save).toHaveBeenLastCalledWith({ id: 'cita-1' });
    });
  });
});

describe('AppointmentsService (estados: cancelar y completar, 2.06)', () => {
  const at = (status: AppointmentStatus) => ({
    id: 'cita-1',
    ownerId: TENANT,
    professionalId: EMPLOYEE,
    status,
  });
  const ownerScope = { tenantId: TENANT };
  const employeeScope = { tenantId: TENANT, professionalId: EMPLOYEE };

  it('cancelar PENDING o CONFIRMED: transacción + lock de fila + motivo', async () => {
    for (const from of [
      AppointmentStatus.PENDING,
      AppointmentStatus.CONFIRMED,
    ]) {
      const { service, repo, txRepo, dataSource } = build();
      repo.findOne.mockResolvedValue(at(from));
      await service.cancel('cita-1', ownerScope, '  no viene  ');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(txRepo.findOne.mock.calls[0][0]).toMatchObject({
        lock: { mode: 'pessimistic_write' },
      });
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'cita-1' },
        {
          status: AppointmentStatus.CANCELLED,
          cancellation_reason: 'no viene',
        },
      );
    }
  });

  it('cancelar sin motivo guarda null; cancelar una cancelada es un no-op', async () => {
    const { service, repo, txRepo } = build();
    repo.findOne.mockResolvedValue(at(AppointmentStatus.PENDING));
    await service.cancel('cita-1', ownerScope);
    expect(txRepo.update).toHaveBeenCalledWith(
      { id: 'cita-1' },
      { status: AppointmentStatus.CANCELLED, cancellation_reason: null },
    );
    txRepo.update.mockClear();
    repo.findOne.mockResolvedValue(at(AppointmentStatus.CANCELLED));
    await service.cancel('cita-1', ownerScope, 'otra');
    expect(txRepo.update).not.toHaveBeenCalled();
  });

  it('cancelar una COMPLETED o completar una CANCELLED: 409 INVALID_STATE_TRANSITION', async () => {
    const cases: [AppointmentStatus, 'cancel' | 'complete'][] = [
      [AppointmentStatus.COMPLETED, 'cancel'],
      [AppointmentStatus.CANCELLED, 'complete'],
    ];
    for (const [from, action] of cases) {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue(at(from));
      const error = await (service as any)
        [action]('cita-1', ownerScope)
        .catch((e) => e);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(txRepo.update).not.toHaveBeenCalled();
    }
  });

  it('completar una CONFIRMED o una PENDING sin pagar (2.15)', async () => {
    for (const from of [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.PENDING,
    ]) {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue(at(from));
      await service.complete('cita-1', ownerScope);
      expect(txRepo.update).toHaveBeenCalledWith(
        { id: 'cita-1' },
        { status: AppointmentStatus.COMPLETED },
      );
    }
  });

  it('cancelar una cita con pago COMPLETED: 409 APPOINTMENT_PAID, consultado bajo el lock (2.15)', async () => {
    for (const via of ['cancel', 'patch'] as const) {
      const { service, repo, txRepo } = build();
      repo.findOne.mockResolvedValue(at(AppointmentStatus.CONFIRMED));
      txRepo.exist.mockResolvedValue(true);
      const error = await (
        via === 'cancel'
          ? service.cancel('cita-1', ownerScope)
          : service.update(
              'cita-1',
              { status: AppointmentStatus.CANCELLED } as any,
              TENANT,
            )
      ).catch((e) => e);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({
        code: ErrorCode.APPOINTMENT_PAID,
      });
      expect(txRepo.exist).toHaveBeenCalledWith({
        where: { appointment: { id: 'cita-1' }, status: 'COMPLETED' },
      });
      expect(txRepo.findOne.mock.invocationCallOrder[0]).toBeLessThan(
        txRepo.exist.mock.invocationCallOrder[0],
      );
      expect(txRepo.update).not.toHaveBeenCalled();
      expect(txRepo.save).not.toHaveBeenCalled();
    }
  });

  it('Employee: crear una cita para otro profesional → 403 sin tocar el cupo; para sí mismo, sí (2.15)', async () => {
    const OTHER = 'c0000000-0000-4000-8000-000000000099';
    const dto = {
      client_id: CLIENT,
      professional_id: OTHER,
      service_ids: [SERVICE],
      date: '2030-01-01T10:00:00',
    } as any;
    const { service, subscriptions, users, txRepo } = build();
    const error = await service.create(dto, employeeScope).catch((e) => e);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(users.findTenantMember).not.toHaveBeenCalled();
    expect(subscriptions.consumeAppointmentQuota).not.toHaveBeenCalled();

    await service.create({ ...dto, professional_id: EMPLOYEE }, employeeScope);
    expect(txRepo.save).toHaveBeenCalledTimes(1);
    // El Owner agenda para cualquiera del negocio.
    await service.create(dto, ownerScope);
    expect(txRepo.save).toHaveBeenCalledTimes(2);
  });

  it('Employee: el lock filtra por su profesional (cita ajena = 404, sin escribir)', async () => {
    const { service, repo, txRepo } = build();
    repo.findOne.mockResolvedValue(null);
    const error = await service.cancel('cita-1', employeeScope).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(txRepo.findOne.mock.calls[0][0].where).toEqual({
      id: 'cita-1',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
    });
    expect(txRepo.update).not.toHaveBeenCalled();
  });

  it('applyPaymentStatus: pago nuevo PENDING → CONFIRMED (también anticipo); COMPLETED se queda; CANCELLED → 409', async () => {
    const { service, manager, txRepo } = build();
    await service.applyPaymentStatus(
      manager as any,
      at(AppointmentStatus.PENDING) as any,
      'PARTIAL' as any,
      true,
    );
    expect(txRepo.update).toHaveBeenLastCalledWith(
      { id: 'cita-1' },
      { payment_status: 'PARTIAL', status: AppointmentStatus.CONFIRMED },
    );
    await service.applyPaymentStatus(
      manager as any,
      at(AppointmentStatus.COMPLETED) as any,
      'COMPLETED' as any,
      true,
    );
    expect(txRepo.update).toHaveBeenLastCalledWith(
      { id: 'cita-1' },
      { payment_status: 'COMPLETED', status: AppointmentStatus.COMPLETED },
    );
    const error = await service
      .applyPaymentStatus(
        manager as any,
        at(AppointmentStatus.CANCELLED) as any,
        'COMPLETED' as any,
        true,
      )
      .catch((e) => e);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });

  it('applyPaymentStatus de un reembolso: solo payment_status, el estado no cambia', async () => {
    const { service, manager, txRepo } = build();
    for (const status of ['PARTIAL', 'REFUNDED']) {
      await service.applyPaymentStatus(
        manager as any,
        at(AppointmentStatus.CONFIRMED) as any,
        status as any,
        false,
      );
      expect(txRepo.update).toHaveBeenLastCalledWith(
        { id: 'cita-1' },
        { payment_status: status },
      );
    }
  });
});

describe('AppointmentsService.remove (borrado físico, 2.25)', () => {
  const appointment = {
    id: 'cita-1',
    ownerId: TENANT,
    status: AppointmentStatus.CONFIRMED,
  };

  it('con pagos: 409 APPOINTMENT_PAID, consultado bajo el lock de la cita, sin borrar', async () => {
    const { service, repo, txRepo, dataSource } = build();
    repo.findOne.mockResolvedValue(appointment);
    txRepo.exist.mockResolvedValue(true);
    const error = await service.remove('cita-1', TENANT).catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.APPOINTMENT_PAID,
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(txRepo.findOne.mock.calls[0][0]).toMatchObject({
      where: { id: 'cita-1', ownerId: TENANT },
      lock: { mode: 'pessimistic_write' },
    });
    // Cualquier pago (también reembolsado): no solo los COMPLETED.
    expect(txRepo.exist).toHaveBeenCalledWith({
      where: { appointment: { id: 'cita-1' } },
    });
    expect(txRepo.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      txRepo.exist.mock.invocationCallOrder[0],
    );
    expect(txRepo.delete).not.toHaveBeenCalled();
  });

  it('sin pagos: se borra dentro de la misma transacción', async () => {
    const { service, repo, txRepo } = build();
    repo.findOne.mockResolvedValue(appointment);
    await service.remove('cita-1', TENANT);
    expect(txRepo.delete).toHaveBeenCalledWith({ id: 'cita-1' });
    expect(txRepo.exist.mock.invocationCallOrder[0]).toBeLessThan(
      txRepo.delete.mock.invocationCallOrder[0],
    );
  });

  it('de otro negocio: 404 sin consultar pagos ni borrar', async () => {
    const { service, repo, txRepo } = build();
    repo.findOne.mockResolvedValue(null);
    const error = await service.remove('cita-1', TENANT).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(txRepo.exist).not.toHaveBeenCalled();
    expect(txRepo.delete).not.toHaveBeenCalled();
  });

  it('otra FK (reseña, bloqueo ligado): el error de BD llega al filtro global (409), no 500', async () => {
    const { service, repo, txRepo } = build();
    repo.findOne.mockResolvedValue(appointment);
    const fk = new QueryFailedError('DELETE', [], new Error('fk'));
    (fk as any).code = '23503';
    txRepo.delete.mockRejectedValue(fk);
    const error = await service.remove('cita-1', TENANT).catch((e) => e);
    expect(error).toBe(fk);
  });
});

describe('AppointmentsService.assertNoAppointmentOverlap (bloqueos, 2.08)', () => {
  const start = new Date('2030-01-07T10:00:00-05:00');
  const end = new Date('2030-01-07T11:00:00-05:00');
  const range = { tenantId: TENANT, professionalId: EMPLOYEE, start, end };

  it('toma el lock del hueco del profesional (el mismo que las citas) antes de buscar cruces', async () => {
    const { service, manager } = build();
    await service.assertNoAppointmentOverlap(manager as any, range);
    const [lockSql, lockParams] = manager.query.mock.calls[0];
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(lockParams).toEqual([`appointment-slot:${EMPLOYEE}`]);
    const [overlapSql, params] = queriesWith(manager, 'FROM appointments')[0];
    expect(overlapSql).toContain('appointments_status_enum[]');
    // [prof, tenant, estados que no ocupan, fin, inicio, excluida]
    expect(params).toEqual([EMPLOYEE, TENANT, ['CANCELLED'], end, start, null]);
  });

  it('cruce con una cita no cancelada → SLOT_UNAVAILABLE "Horario no disponible"', async () => {
    const { service, manager, db } = build();
    db.overlaps = [{ id: 'cita' }];
    await expect(
      service.assertNoAppointmentOverlap(manager as any, range),
    ).rejects.toMatchObject({
      code: ErrorCode.SLOT_UNAVAILABLE,
      message: 'Horario no disponible',
    });
  });

  it('excluye la cita ligada al bloqueo y exige tenant y profesional', async () => {
    const { service, manager } = build();
    await service.assertNoAppointmentOverlap(manager as any, {
      ...range,
      excludeAppointmentId: 'ligada',
    });
    expect(queriesWith(manager, 'FROM appointments')[0][1][5]).toBe('ligada');
    await expect(
      service.assertNoAppointmentOverlap(manager as any, {
        ...range,
        tenantId: undefined,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AppointmentsService.findAvailableSlots (huecos libres, 2.14)', () => {
  // 2030-01-07 es lunes; día del negocio (Bogotá).
  const day = new Date('2030-01-07T00:00:00-05:00');
  const at = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00-05:00`);
  const query = {
    professionalId: EMPLOYEE,
    day,
    serviceIds: [SERVICE],
    stepMinutes: 30,
  };
  const workday = [
    {
      day_of_week: 1,
      start_time: '09:00:00',
      end_time: '11:00:00',
      is_available: true,
    },
  ];

  it('horario, bloqueos y citas: devuelve solo los inicios libres, sin lock ni transacción', async () => {
    const { service, db, manager, dataSource } = build();
    db.schedules = workday;
    db.blocks = [{ start: at('09:00'), end: at('09:30') }];
    db.overlaps = [{ id: 'cita', start: at('10:00'), end: at('10:30') }];
    const slots = await service.findAvailableSlots(query, TENANT);
    expect(slots).toEqual([at('09:30'), at('10:30')]);
    expect(queriesWith(manager, 'pg_advisory_xact_lock')).toHaveLength(0);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('usa las MISMAS consultas que al guardar, sobre todo el día (+ la duración)', async () => {
    const { service, manager } = build();
    await service.findAvailableSlots(query, TENANT);
    const [[apptSql, apptParams]] = queriesWith(manager, 'FROM appointments');
    expect(apptSql).toContain('NOT (a.status = ANY($3');
    // [prof, tenant, estados que no ocupan, fin del rango, inicio, excluida]
    expect(apptParams).toEqual([
      EMPLOYEE,
      TENANT,
      ['CANCELLED'],
      new Date('2030-01-08T00:30:00-05:00'),
      day,
      null,
    ]);
    const [[, blockParams]] = queriesWith(manager, 'FROM time_block');
    expect(blockParams).toEqual([
      EMPLOYEE,
      new Date('2030-01-08T00:30:00-05:00'),
      day,
      null,
    ]);
  });

  it('la duración es la suma de los servicios pedidos (sin duración = 30 min)', async () => {
    const { service, services, db } = build();
    db.schedules = workday;
    services.findOne
      .mockResolvedValueOnce({ id: SERVICE, price: '1', duration: 60 })
      .mockResolvedValueOnce({ id: 'otro', price: '1', duration: null });
    const slots = await service.findAvailableSlots(
      { ...query, serviceIds: [SERVICE, 'otro'] },
      TENANT,
    );
    expect(slots).toEqual([at('09:00'), at('09:30')]); // 90 min hasta las 11:00
  });

  it('Employee: otra agenda → 403 sin leer nada; la suya, sí', async () => {
    const { service, users, manager } = build();
    const scope = { tenantId: TENANT, professionalId: 'otro-empleado' };
    const error = await service
      .findAvailableSlots(query, scope)
      .catch((e) => e);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: ErrorCode.FORBIDDEN });
    expect(users.findTenantMember).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
    await service.findAvailableSlots(query, {
      tenantId: TENANT,
      professionalId: EMPLOYEE,
    });
    expect(users.findTenantMember).toHaveBeenCalledWith(EMPLOYEE, TENANT);
  });

  it('profesional o servicio de otro negocio → 404; profesional inactivo → PROFESSIONAL_INACTIVE', async () => {
    const { service, users, services, manager } = build();
    services.findOne.mockResolvedValueOnce(null);
    await expect(
      service.findAvailableSlots(query, TENANT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(services.findOne).toHaveBeenCalledWith(SERVICE, TENANT);

    users.findTenantMember.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.findAvailableSlots(query, TENANT),
    ).rejects.toBeInstanceOf(NotFoundException);

    users.findTenantMember.mockResolvedValueOnce({
      id: EMPLOYEE,
      isActive: false,
    });
    await expect(
      service.findAvailableSlots(query, TENANT),
    ).rejects.toMatchObject({ code: ErrorCode.PROFESSIONAL_INACTIVE });
    expect(manager.query).not.toHaveBeenCalled();
  });
});

describe('AppointmentsService: solo a futuro (2.21)', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('crear en una hora pasada → APPOINTMENT_IN_PAST 400 sin leer ni consumir el cupo', async () => {
    const { service, subscriptions, users, txRepo } = build();
    const error = await service
      .create({ ...dto, date: '2000-01-03T10:00:00' }, TENANT)
      .catch((e) => e);
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'APPOINTMENT_IN_PAST' });
    expect(users.findTenantMember).not.toHaveBeenCalled();
    expect(subscriptions.consumeAppointmentQuota).not.toHaveBeenCalled();
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  describe('mover', () => {
    const past = new Date('2000-01-03T10:00:00-05:00');
    const setup = () => {
      const ctx = build();
      ctx.repo.findOne.mockResolvedValue({
        id: 'cita',
        ownerId: TENANT,
        professionalId: EMPLOYEE,
        date: past,
        status: AppointmentStatus.PENDING,
        services: [{ duration: 30 }],
      });
      return ctx;
    };

    it('a otra hora pasada → APPOINTMENT_IN_PAST y no guarda', async () => {
      const { service, txRepo } = setup();
      const error = await service
        .update('cita', { date: '2000-01-04T10:00:00-05:00' } as any, TENANT)
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        code: 'APPOINTMENT_IN_PAST',
      });
      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('reenviar la MISMA fecha pasada (lo que hace la app al editar) sí guarda', async () => {
      const { service, txRepo } = setup();
      await service.update(
        'cita',
        { date: past.toISOString(), notes: 'nota' } as any,
        TENANT,
      );
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'nota' }),
      );
    });

    it('una cita pasada se puede mover a una hora futura', async () => {
      const { service, txRepo } = setup();
      await service.update(
        'cita',
        { date: '2030-01-07T10:00:00-05:00' } as any,
        TENANT,
      );
      expect(txRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  it('available-slots de un día pasado → [] (las horas pasadas no se ofrecen)', async () => {
    const { service } = build();
    const slots = await service.findAvailableSlots(
      {
        professionalId: EMPLOYEE,
        day: new Date('2000-01-03T00:00:00-05:00'),
        serviceIds: [SERVICE],
        stepMinutes: 30,
      },
      TENANT,
    );
    expect(slots).toEqual([]);
  });
});

describe('AppointmentsService: precio de cada servicio guardado en la cita (2.29)', () => {
  const OTHER = 'c0000000-0000-4000-8000-000000000003';
  const NEW = 'c0000000-0000-4000-8000-000000000004';
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  const catalog = (prices: Record<string, string>) => (id: string) =>
    Promise.resolve({ id, price: prices[id], duration: 30 });

  it('crear guarda una línea por servicio con su precio actual y total = suma (sin coma flotante)', async () => {
    const { service, services, txRepo } = build();
    services.findOne.mockImplementation(
      catalog({ [SERVICE]: '0.10', [OTHER]: '0.20' }),
    );
    const created = await service.create(
      { ...dto, service_ids: [SERVICE, OTHER] },
      TENANT,
    );
    const [saved] = txRepo.save.mock.calls[0];
    expect(saved.total_price).toBe(0.3);
    expect(saved.serviceLines.map((l: any) => [l.serviceId, l.price])).toEqual([
      [SERVICE, '0.10'],
      [OTHER, '0.20'],
    ]);
    expect(saved).not.toHaveProperty('services');
    // La respuesta sigue trayendo `services`, con el precio en la cita.
    expect(
      created.services.map((s: any) => [s.id, s.appointment_price]),
    ).toEqual([
      [SERVICE, '0.10'],
      [OTHER, '0.20'],
    ]);
  });

  it('editar con los mismos servicios tras subir el precio del catálogo NO cambia el total ni las líneas', async () => {
    const { service, repo, services, txRepo, lines, lineRepo } = build();
    lines.push({
      appointmentId: 'cita-1',
      serviceId: SERVICE,
      price: '30000.00',
    });
    repo.findOne.mockResolvedValue({
      id: 'cita-1',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
      date: new Date('2030-01-01T10:00:00-05:00'),
      status: AppointmentStatus.PENDING,
      total_price: '30000',
      services: [{ id: SERVICE, duration: 30 }],
    });
    services.findOne.mockImplementation(catalog({ [SERVICE]: '50000.00' }));

    await service.update(
      'cita-1',
      { service_ids: [SERVICE], notes: 'x' } as any,
      TENANT,
    );

    const [saved] = txRepo.save.mock.calls[0];
    expect(saved.total_price).toBe(30000);
    expect(lines).toEqual([
      { appointmentId: 'cita-1', serviceId: SERVICE, price: '30000.00' },
    ]);
    expect(lineRepo.insert).not.toHaveBeenCalled();
    expect(lineRepo.delete).not.toHaveBeenCalled();
  });

  it('cambiar servicios: el que se queda conserva su precio, el nuevo toma el actual y el quitado se borra', async () => {
    const { service, repo, services, txRepo, lines } = build();
    lines.push(
      { appointmentId: 'cita-1', serviceId: SERVICE, price: '30000.00' },
      { appointmentId: 'cita-1', serviceId: OTHER, price: '5000.00' },
    );
    repo.findOne.mockResolvedValue({
      id: 'cita-1',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
      date: new Date('2030-01-01T10:00:00-05:00'),
      status: AppointmentStatus.PENDING,
      total_price: '35000',
      services: [],
    });
    services.findOne.mockImplementation(
      catalog({ [SERVICE]: '50000.00', [NEW]: '8000.00' }),
    );

    await service.update(
      'cita-1',
      { service_ids: [SERVICE, NEW] } as any,
      TENANT,
    );

    expect(txRepo.save.mock.calls[0][0].total_price).toBe(38000);
    expect(lines).toEqual([
      { appointmentId: 'cita-1', serviceId: SERVICE, price: '30000.00' },
      { appointmentId: 'cita-1', serviceId: NEW, price: '8000.00' },
    ]);
  });

  it('mover la cita (solo la fecha) no toca el total ni las líneas', async () => {
    const { service, repo, txRepo, lineRepo } = build();
    repo.findOne.mockResolvedValue({
      id: 'cita-1',
      ownerId: TENANT,
      professionalId: EMPLOYEE,
      date: new Date('2030-01-01T10:00:00-05:00'),
      status: AppointmentStatus.PENDING,
      total_price: '30000',
      services: [{ id: SERVICE, duration: 30 }],
    });
    await service.update(
      'cita-1',
      { date: '2030-01-02T10:00:00' } as any,
      TENANT,
    );
    expect(txRepo.save.mock.calls[0][0]).not.toHaveProperty('total_price');
    expect(lineRepo.find).not.toHaveBeenCalled();
  });
});
