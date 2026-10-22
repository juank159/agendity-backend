import { NotFoundException } from '@nestjs/common';
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
    checkSubscriptionStatus: jest
      .fn()
      .mockResolvedValue({ canCreateAppointment: true }),
    updateTrialAppointmentUsage: jest.fn(),
  };
  const service = new AppointmentsService(
    repo as any,
    clients as any,
    users as any,
    services as any,
    events as any,
    subscriptions as any,
  );
  return { service, repo, clients, users, services, subscriptions };
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
    const { service, repo, clients, users, services, subscriptions } = build();
    await service.create(dto, TENANT);
    expect(clients.findOne).toHaveBeenCalledWith(CLIENT, TENANT);
    expect(users.findTenantMember).toHaveBeenCalledWith(EMPLOYEE, TENANT);
    expect(services.findOne).toHaveBeenCalledWith(SERVICE, TENANT);
    expect(subscriptions.checkSubscriptionStatus).toHaveBeenCalledWith(TENANT);
    expect(subscriptions.updateTrialAppointmentUsage).toHaveBeenCalledWith(
      TENANT,
    );
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: TENANT, professionalId: EMPLOYEE }),
    );
  });

  it('create con un profesional de otro negocio: 404 sin tocar la suscripción ni guardar', async () => {
    const { service, repo, users, subscriptions } = build();
    users.findTenantMember.mockRejectedValue(
      new NotFoundException('Profesional no encontrado'),
    );
    await expect(service.create(dto, TENANT)).rejects.toThrow(
      NotFoundException,
    );
    expect(subscriptions.checkSubscriptionStatus).not.toHaveBeenCalled();
    expect(subscriptions.updateTrialAppointmentUsage).not.toHaveBeenCalled();
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
