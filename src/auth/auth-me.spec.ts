import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { USER_SECRET_FIELDS } from 'src/users/entities/user.entity';

const OWNER = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build(user: Record<string, any> | null) {
  const userRepository = { findOne: jest.fn().mockResolvedValue(user) };
  // 6.01: la zona del negocio sale de TenantSettingsService (cacheada).
  const tenantSettings = {
    getTimezone: jest.fn().mockResolvedValue('America/Caracas'),
  };
  const service = new AuthService(
    userRepository as any,
    {} as any,
    {} as any,
    { get: () => undefined } as unknown as ConfigService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    tenantSettings as any,
  );
  return { service, userRepository, tenantSettings };
}

describe('AuthService.me: usuario de la sesión (2.35)', () => {
  it('Employee: solo los campos de la sesión, tenant = su owner y sin secretos', async () => {
    const { service, userRepository, tenantSettings } = build({
      id: EMPLOYEE,
      name: 'Ana',
      lastname: 'Prueba',
      email: 'ana@test.co',
      phone: '3001234567',
      image: null,
      isActive: true,
      is_email_verified: false,
      is_google_account: false,
      notification_token: 'push-token',
      tenant_id: OWNER,
      password: '$2b$hash',
      verification_code: '123456',
      verification_code_expires: new Date(),
      reset_password_code: '654321',
      reset_password_expires: new Date(),
      roles: [{ id: 'r', name: 'Employee', permissions: [] }],
      owner: { id: OWNER, name: 'Dueño' },
    });

    const me = await service.me(EMPLOYEE);
    expect(tenantSettings.getTimezone).toHaveBeenCalledWith(OWNER);

    expect(me).toEqual({
      id: EMPLOYEE,
      name: 'Ana',
      lastname: 'Prueba',
      email: 'ana@test.co',
      phone: '3001234567',
      image: null,
      roles: [{ name: 'Employee' }],
      tenantId: OWNER,
      timezone: 'America/Caracas',
      isActive: true,
      is_email_verified: false,
    });
    for (const secret of USER_SECRET_FIELDS) {
      expect(me).not.toHaveProperty(secret);
    }
    expect(userRepository.findOne).toHaveBeenCalledWith({
      where: { id: EMPLOYEE },
      relations: ['roles', 'owner'],
    });
  });

  it('Owner: tenantId = su id y la zona de SU negocio (6.01)', async () => {
    const { service, tenantSettings } = build({
      id: OWNER,
      name: 'Dueño',
      email: 'd@test.co',
      is_email_verified: true,
      isActive: true,
      roles: [{ name: 'Owner' }],
      owner: null,
    });
    const me = await service.me(OWNER);
    expect(me.tenantId).toBe(OWNER);
    expect(me.timezone).toBe('America/Caracas');
    expect(tenantSettings.getTimezone).toHaveBeenCalledWith(OWNER);
  });

  it('sin fila: 404', async () => {
    const { service } = build(null);
    await expect(service.me(OWNER)).rejects.toBeInstanceOf(NotFoundException);
  });
});
