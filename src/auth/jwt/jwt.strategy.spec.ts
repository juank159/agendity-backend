import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const OLD_RANDOM_TENANT = '55555555-5555-4555-8555-555555555555';

function build(dbUser: unknown = null) {
  const config = { get: () => 'secreto' } as unknown as ConfigService;
  const userRepository = { findOne: jest.fn().mockResolvedValue(dbUser) };
  const strategy = new JwtStrategy(config, userRepository as any);
  return { strategy, userRepository };
}

describe('JwtStrategy.validate → AuthUser', () => {
  it('Owner con token nuevo: tenantId = ownerId = su id, sin consultar la BD', async () => {
    const { strategy, userRepository } = build();
    const user = await strategy.validate({
      id: OWNER_ID,
      name: 'Ana',
      email: 'ana@x.co',
      roles: ['Owner'],
      tenantId: OWNER_ID,
      ownerId: OWNER_ID,
      tenant_id: OWNER_ID,
    });
    expect(user).toEqual({
      id: OWNER_ID,
      name: 'Ana',
      email: 'ana@x.co',
      roles: ['Owner'],
      tenantId: OWNER_ID,
      ownerId: OWNER_ID,
    });
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('Employee con token nuevo: tenantId = ownerId = id de su owner', async () => {
    const { strategy, userRepository } = build();
    const user = await strategy.validate({
      id: EMPLOYEE_ID,
      name: 'Luis',
      email: 'luis@x.co',
      roles: ['Employee'],
      tenantId: OWNER_ID,
      ownerId: OWNER_ID,
    });
    expect(user.tenantId).toBe(OWNER_ID);
    expect(user.ownerId).toBe(OWNER_ID);
    expect(user.id).toBe(EMPLOYEE_ID);
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('token antiguo de Owner: ignora su tenant_id aleatorio y usa su id (BD)', async () => {
    const { strategy, userRepository } = build({ id: OWNER_ID, owner: null });
    const user = await strategy.validate({
      id: OWNER_ID,
      name: 'Ana',
      email: 'ana@x.co',
      roles: ['Owner'],
      tenant_id: OLD_RANDOM_TENANT,
    });
    expect(user.tenantId).toBe(OWNER_ID);
    expect(user.ownerId).toBe(OWNER_ID);
    expect(user.roles).toEqual(['Owner']);
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: OWNER_ID },
      relations: ['owner'],
    });
  });

  it('token antiguo de Employee (sin tenant): resuelve su owner en la BD', async () => {
    const { strategy } = build({ id: EMPLOYEE_ID, owner: { id: OWNER_ID } });
    const user = await strategy.validate({
      id: EMPLOYEE_ID,
      name: 'Luis',
      email: 'luis@x.co',
      roles: ['Employee'],
    });
    expect(user.tenantId).toBe(OWNER_ID);
    expect(user.ownerId).toBe(OWNER_ID);
  });

  it('token antiguo de un usuario que ya no existe (o está borrado): 401', async () => {
    const { strategy } = build(null);
    await expect(
      strategy.validate({
        id: EMPLOYEE_ID,
        name: 'Luis',
        email: 'luis@x.co',
        roles: ['Employee'],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('payload sin id: 401', async () => {
    const { strategy } = build();
    await expect(strategy.validate({} as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
