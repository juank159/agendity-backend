import { NotFoundException } from '@nestjs/common';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AppointmentsService } from './appointments.service';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { AppointmentStatus } from 'src/common/enums/status.enum';

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
  const txRepo = { save: jest.fn(async (a) => ({ id: 'nueva', ...a })) };
  // Lo que "hay" en la BD para el hueco: horarios, bloqueos y citas que se cruzan.
  const db = {
    schedules: [] as any[],
    blocks: [] as any[],
    overlaps: [] as any[],
  };
  const scheduleRepo = { find: jest.fn(async () => db.schedules) };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === Schedule ? scheduleRepo : txRepo,
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

    it('reactivar una cita CANCELLED vuelve a comprobar el hueco', async () => {
      const { service, repo, db } = build();
      repo.findOne.mockResolvedValue({
        ...existing(),
        status: AppointmentStatus.CANCELLED,
      });
      db.overlaps = [{ id: 'otra' }];
      const error = await service
        .update('cita-1', { status: AppointmentStatus.PENDING } as any, TENANT)
        .catch((e) => e);
      expectSlotUnavailable(error);
    });
  });
});
