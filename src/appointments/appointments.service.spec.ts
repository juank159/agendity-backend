import { NotFoundException } from '@nestjs/common';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AppointmentsService } from './appointments.service';

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
    findTenantMember: jest.fn().mockResolvedValue({ id: EMPLOYEE }),
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
  const manager = { getRepository: jest.fn(() => txRepo) };
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
  };
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
    const { service, subscriptions, txRepo, repo, events } = build();
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
    expect(repo.find).not.toHaveBeenCalled(); // ni siquiera mira el horario
    expect(txRepo.save).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('si la cita no se puede crear después de consumir, la transacción falla (rollback del cupo)', async () => {
    const { service, repo, txRepo, dataSource, events } = build();
    repo.find.mockResolvedValue([
      {
        date: new Date('2030-01-01T10:00:00'),
        services: [{ duration: 30 }],
      },
    ]);
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
