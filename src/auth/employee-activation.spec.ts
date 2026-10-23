import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  AuthService,
  assertCanActivateEmployee,
  canActivateEmployee,
} from './auth.service';

const OWNER = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build(employee: Record<string, any> | null) {
  const config = { get: jest.fn() } as unknown as ConfigService;
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(employee),
    save: jest.fn(async (x) => x),
    update: jest.fn(async () => ({ affected: 1 })),
    restore: jest.fn(async () => ({ affected: 1 })),
  };
  const service = new AuthService(
    userRepository as any,
    {} as any,
    {} as any,
    config,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, userRepository };
}

const employee = (verified: boolean, extra: Record<string, any> = {}) => ({
  id: EMPLOYEE,
  isActive: false,
  is_email_verified: verified,
  roles: [{ name: 'Employee' }],
  owner: { id: OWNER },
  ...extra,
});

describe('Activar empleados exige el email verificado (2.15)', () => {
  it('regla pura', () => {
    expect(canActivateEmployee({ is_email_verified: true })).toBe(true);
    expect(canActivateEmployee({ is_email_verified: false })).toBe(false);
    expect(canActivateEmployee({})).toBe(false);
    expect(() =>
      assertCanActivateEmployee({ is_email_verified: false }),
    ).toThrow('verificar su email');
  });

  it('toggle-status a activo con email sin verificar: 409 EMAIL_NOT_VERIFIED sin guardar', async () => {
    const { service, userRepository } = build(employee(false));
    const error = await service
      .toggleEmployeeStatus(OWNER, EMPLOYEE, { isActive: true })
      .catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.EMAIL_NOT_VERIFIED,
    });
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('toggle-status: desactivar siempre se puede; activar con email verificado, sí', async () => {
    const unverified = build(employee(false, { isActive: true }));
    await unverified.service.toggleEmployeeStatus(OWNER, EMPLOYEE, {
      isActive: false,
    });
    expect(unverified.userRepository.save.mock.calls[0][0].isActive).toBe(
      false,
    );

    const verified = build(employee(true));
    await verified.service.toggleEmployeeStatus(OWNER, EMPLOYEE, {
      isActive: true,
    });
    expect(verified.userRepository.save.mock.calls[0][0].isActive).toBe(true);
    // Siempre acotado al Owner que llama (ya no hay rama sin owner).
    expect(verified.userRepository.findOne.mock.calls[0][0].where).toEqual({
      id: EMPLOYEE,
      owner: { id: OWNER },
    });
  });

  it('toggle-status de un empleado ajeno: 404', async () => {
    const { service } = build(null);
    await expect(
      service.toggleEmployeeStatus(OWNER, EMPLOYEE, { isActive: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('restore: sin email verificado se restaura INACTIVO; verificado, activo', async () => {
    const deletedAt = new Date();
    const unverified = build(employee(false, { deletedAt }));
    const r1 = await unverified.service.restoreEmployee(OWNER, EMPLOYEE);
    expect(unverified.userRepository.restore).toHaveBeenCalledWith(EMPLOYEE);
    expect(unverified.userRepository.update).toHaveBeenCalledWith(
      EMPLOYEE,
      expect.objectContaining({ isActive: false }),
    );
    expect(r1).toMatchObject({ isActive: false });

    const verified = build(employee(true, { deletedAt }));
    const r2 = await verified.service.restoreEmployee(OWNER, EMPLOYEE);
    expect(verified.userRepository.update).toHaveBeenCalledWith(
      EMPLOYEE,
      expect.objectContaining({ isActive: true }),
    );
    expect(r2).toMatchObject({ isActive: true });
  });
});
