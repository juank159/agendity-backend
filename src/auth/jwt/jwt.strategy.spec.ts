import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const OLD_RANDOM_TENANT = '55555555-5555-4555-8555-555555555555';

const ownerRow = (extra: Record<string, unknown> = {}) => ({
  id: OWNER_ID,
  isActive: true,
  is_email_verified: true,
  deletedAt: null,
  owner: null,
  roles: [{ name: 'Owner' }],
  ...extra,
});
const employeeRow = (extra: Record<string, unknown> = {}) => ({
  id: EMPLOYEE_ID,
  isActive: true,
  is_email_verified: true,
  deletedAt: null,
  owner: { id: OWNER_ID, isActive: true, deletedAt: null },
  roles: [{ name: 'Employee' }],
  ...extra,
});

function build(dbUser: unknown = null) {
  const config = { get: () => 'secreto' } as unknown as ConfigService;
  const userRepository = { findOne: jest.fn().mockResolvedValue(dbUser) };
  const strategy = new JwtStrategy(config, userRepository as any);
  return { strategy, userRepository };
}

const employeePayload = {
  id: EMPLOYEE_ID,
  name: 'Luis',
  email: 'luis@x.co',
  roles: ['Employee'],
  tenantId: OWNER_ID,
  ownerId: OWNER_ID,
};

async function rejection(promise: Promise<unknown>) {
  const error = (await promise.catch((e) => e)) as HttpException;
  expect(error).toBeInstanceOf(HttpException);
  return { status: error.getStatus(), body: error.getResponse() };
}

describe('JwtStrategy.validate → AuthUser', () => {
  it('Owner: tenantId = ownerId = su id; consulta la cuenta (con borrados) en cada petición', async () => {
    const { strategy, userRepository } = build(ownerRow());
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
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: OWNER_ID },
      relations: { owner: true, roles: true },
      withDeleted: true,
    });
  });

  it('Employee: tenantId = ownerId = id de su owner', async () => {
    const { strategy } = build(employeeRow());
    const user = await strategy.validate(employeePayload);
    expect(user.tenantId).toBe(OWNER_ID);
    expect(user.ownerId).toBe(OWNER_ID);
    expect(user.id).toBe(EMPLOYEE_ID);
  });

  it('token antiguo de Owner: ignora su tenant_id aleatorio y usa su id (BD)', async () => {
    const { strategy } = build(ownerRow());
    const user = await strategy.validate({
      id: OWNER_ID,
      name: 'Ana',
      email: 'ana@x.co',
      roles: ['Owner'],
      tenant_id: OLD_RANDOM_TENANT,
    });
    expect(user.tenantId).toBe(OWNER_ID);
    expect(user.roles).toEqual(['Owner']);
  });

  it('token antiguo de Employee (sin tenant): resuelve su owner en la BD', async () => {
    const { strategy } = build(employeeRow());
    const user = await strategy.validate({
      id: EMPLOYEE_ID,
      name: 'Luis',
      email: 'luis@x.co',
      roles: ['Employee'],
    });
    expect(user.tenantId).toBe(OWNER_ID);
  });

  it('usuario que ya no existe: 401', async () => {
    const { strategy } = build(null);
    await expect(strategy.validate(employeePayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['desactivado', employeeRow({ isActive: false })],
    [
      'sin verificar (nace inactivo)',
      employeeRow({ isActive: false, is_email_verified: false }),
    ],
    ['borrado (soft-delete)', employeeRow({ deletedAt: new Date() })],
    ['huérfano: sin owner', employeeRow({ owner: null })],
    [
      'huérfano: owner borrado',
      employeeRow({
        owner: { id: OWNER_ID, isActive: true, deletedAt: new Date() },
      }),
    ],
  ])('token vigente de un empleado %s: 401 UNAUTHORIZED', async (_, row) => {
    const { strategy } = build(row);
    const { status, body } = await rejection(
      strategy.validate(employeePayload),
    );
    expect(status).toBe(401);
    expect(body).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('payload sin id: 401', async () => {
    const { strategy } = build();
    await expect(strategy.validate({} as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
