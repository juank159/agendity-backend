import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

/**
 * 6.01: el alta del Owner (email y Google) crea la configuración del negocio
 * con la zona que manda la app, en la MISMA transacción que el usuario y el
 * trial (`createOwnerAccount`).
 */
function build() {
  const manager = {
    getRepository: () => ({
      create: (data: any) => data,
      save: jest.fn(async (data: any) => ({ ...data })),
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: unknown) => unknown) =>
      work(manager),
    ),
  };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    exist: jest.fn().mockResolvedValue(false),
    exists: jest.fn().mockResolvedValue(false),
  };
  const roleRepository = {
    findOne: jest.fn().mockResolvedValue({ id: 'r', name: 'Owner' }),
  };
  const subscriptions = { createTrialSubscription: jest.fn() };
  const tenantSettings = { createForTenant: jest.fn() };
  const service = new AuthService(
    userRepository as any,
    roleRepository as any,
    { sign: jest.fn().mockReturnValue('jwt') } as any,
    {
      get: (k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'web-id' : undefined),
    } as unknown as ConfigService,
    {} as any,
    subscriptions as any,
    dataSource as any,
    {} as any,
    tenantSettings as any,
  );
  return { service, manager, subscriptions, tenantSettings, dataSource };
}

const DTO = {
  name: 'Ana',
  lastname: 'Prueba',
  email: 'ana@test.co',
  phone: '3001234567',
  password: 'Secreta1!',
};

describe('Alta del Owner con zona horaria (6.01)', () => {
  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => {
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$hash' as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([['America/Caracas'], [undefined], ['Mars/Phobos']])(
    'register/owner con timezone %p: la pasa a createForTenant con el manager de la transacción y no la guarda en users',
    async (timezone) => {
      const { service, manager, subscriptions, tenantSettings, dataSource } =
        build();
      const result = await service.createOwner({ ...DTO, timezone });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      const id = result.user.id;
      expect(subscriptions.createTrialSubscription).toHaveBeenCalledWith(
        id,
        manager,
      );
      expect(tenantSettings.createForTenant).toHaveBeenCalledWith(
        id,
        { timezone, name: undefined },
        manager,
      );
      expect(result.user).not.toHaveProperty('timezone');
    },
  );

  it('si falla la configuración, el error sale de la transacción (rollback del alta)', async () => {
    const { service, tenantSettings } = build();
    tenantSettings.createForTenant.mockRejectedValue(new Error('boom'));
    await expect(
      service.createOwner({ ...DTO, timezone: 'America/Bogota' }),
    ).rejects.toThrow('boom');
  });

  it('alta nueva por Google: pasa la zona del dispositivo', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockResolvedValue({
        getPayload: () => ({
          email: 'g@gmail.com',
          email_verified: true,
          name: 'Ana Pérez',
        }),
      } as any);
    const { service, tenantSettings, manager } = build();
    const result = await service.googleLogin('id-token', 'Europe/Madrid');
    expect(tenantSettings.createForTenant).toHaveBeenCalledWith(
      result.user.id,
      { timezone: 'Europe/Madrid' },
      manager,
    );
  });

  it('8.00: el nombre del negocio va a la configuración, no a users', async () => {
    const { service, tenantSettings, manager } = build();
    const result = await service.createOwner({
      ...DTO,
      business_name: 'Estudio Cejas & Pestañas',
    });
    expect(tenantSettings.createForTenant).toHaveBeenCalledWith(
      result.user.id,
      { timezone: undefined, name: 'Estudio Cejas & Pestañas' },
      manager,
    );
    expect(result.user).not.toHaveProperty('business_name');
  });
});
