import { UserServicesService } from './user-services.service';

describe('UserServicesService.findMine', () => {
  const service = (id: string) => ({
    id,
    name: id,
    duration: 30,
    price: '25000.00',
    color: '#000',
    category: null,
  });

  function build() {
    const find = jest.fn<Promise<any[]>, [any]>(async () => [
      { service: service('s1'), commissionPercentage: null },
    ]);
    const serviceFind = jest.fn<Promise<any[]>, [any]>(async () => [
      service('s1'),
      service('s2'),
    ]);
    const repo = {
      find,
      manager: {
        getRepository: (entity: { name: string }) =>
          entity.name === 'Service'
            ? { find: serviceFind }
            : { findOne: async () => ({ commission_percentage: '40.00' }) },
      },
    };
    const svc = new UserServicesService(repo as any, {} as any, {} as any);
    return { svc, find, serviceFind };
  }

  it('Employee: filtra por SU id, asignación activa y servicio activo del negocio', async () => {
    const { svc, find } = build();
    const result = await svc.findMine({
      id: 'emp',
      roles: ['Employee'],
      tenantId: 'owner',
    } as any);
    expect(find.mock.calls[0][0].where).toEqual({
      userId: 'emp',
      isActive: true,
      service: { ownerId: 'owner', isActive: true },
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 's1',
        price: 25000,
        commission_percentage: 40,
      }),
    ]);
  });

  it('Owner: todos los servicios activos del negocio', async () => {
    const { svc, serviceFind } = build();
    const result = await svc.findMine({
      id: 'owner',
      roles: ['Owner'],
      tenantId: 'owner',
    } as any);
    expect(serviceFind.mock.calls[0][0].where).toEqual({
      ownerId: 'owner',
      isActive: true,
    });
    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
