import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  EmployeesService,
  assertCanActivateEmployee,
  canActivateEmployee,
  emailChanges,
  initialEmployeeState,
} from './employees.service';

const OWNER = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build(employee: Record<string, any> | null) {
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(employee),
    save: jest.fn(async (x) => x),
    update: jest.fn(async () => ({ affected: 1 })),
    restore: jest.fn(async () => ({ affected: 1 })),
  };
  const service = new EmployeesService(
    userRepository as any,
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

describe('Los empleados nacen inactivos hasta verificar el email (2.16)', () => {
  const owner = {
    id: OWNER,
    name: 'Owner',
    email: 'owner@test.co',
    roles: ['Owner'],
    tenantId: OWNER,
    ownerId: null,
  } as any;

  function buildCreate() {
    const saved: any[] = [];
    const manager = {
      create: jest.fn((_entity, data) => ({ ...data })),
      save: jest.fn(async (x) => {
        if (!Array.isArray(x) && !x.id) x.id = EMPLOYEE;
        saved.push(x);
        return x;
      }),
      findOne: jest.fn(async () => ({
        ...saved[0],
        roles: [{ name: 'Employee' }],
      })),
      // Servicios del negocio (auditoría 2026-11-01: se comprueban antes).
      getRepository: () => ({
        count: jest.fn(async ({ where }) => where.id.value.length),
      }),
    };
    const userRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const roleRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'r', name: 'Employee' }),
    };
    const dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    const service = new EmployeesService(
      userRepository as any,
      roleRepository as any,
      dataSource as any,
      {} as any,
    );
    return { service, manager, saved };
  }

  const dto = {
    name: 'Ana',
    lastname: 'Prueba',
    email: 'ana@test.co',
    phone: '3000000000',
    password: 'Clave123!',
    schedule: { monday: { start: '09:00', end: '18:00' } },
    services: [
      {
        serviceId: '11111111-1111-4111-8111-111111111111',
        commissionPercentage: 10,
      },
    ],
  } as any;

  it('regla pura: inactivo y sin verificar', () => {
    expect(initialEmployeeState()).toEqual({
      isActive: false,
      is_email_verified: false,
    });
  });

  it('createEmployee guarda el empleado inactivo y sin verificar, con sus horarios y servicios', async () => {
    const { service, saved } = buildCreate();
    const result = await service.createEmployee(dto, owner);

    const employee = saved[0];
    expect(employee).toMatchObject({
      isActive: false,
      is_email_verified: false,
      tenant_id: OWNER,
      owner: { id: OWNER },
    });
    // Horarios y servicios se configuran aunque nazca inactivo.
    const services = saved.find(
      (x) => Array.isArray(x) && x[0]?.serviceId !== undefined,
    );
    const schedules = saved.find(
      (x) => Array.isArray(x) && x[0]?.day_of_week !== undefined,
    );
    expect(services).toHaveLength(1);
    expect(schedules).toHaveLength(1);
    expect(result.user).toMatchObject({
      isActive: false,
      is_email_verified: false,
    });
  });

  it('el DTO no puede forzar un alta activa o verificada', async () => {
    const { service, saved } = buildCreate();
    await service.createEmployee(
      { ...dto, isActive: true, is_email_verified: true },
      owner,
    );
    expect(saved[0]).toMatchObject({
      isActive: false,
      is_email_verified: false,
    });
  });
});

describe('Empleados: borrar, lista agendable y cambio de email (2.33)', () => {
  it('borrar al dueño (su propio id): 409 OWNER_NOT_DELETABLE sin consultar ni escribir (antes 404)', async () => {
    const { service, userRepository } = build(null);
    const error = await service.deleteEmployee(OWNER, OWNER).catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.OWNER_NOT_DELETABLE,
    });
    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('borrar un empleado ya borrado: 409 CONFLICT "ya ha sido eliminado" (lo busca con withDeleted)', async () => {
    const { service, userRepository } = build(
      employee(true, { deletedAt: new Date() }),
    );
    (userRepository as any).softDelete = jest.fn();
    const error = await service.deleteEmployee(OWNER, EMPLOYEE).catch((e) => e);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.CONFLICT,
      message: 'El empleado ya ha sido eliminado previamente',
    });
    expect(userRepository.findOne.mock.calls[0][0]).toMatchObject({
      withDeleted: true,
    });
    expect((userRepository as any).softDelete).not.toHaveBeenCalled();
  });

  it('employees/active: solo los agendables (activos, sin borrar y verificados; el Owner aunque no verifique)', async () => {
    const { service } = build(null);
    jest.spyOn(service, 'getEmployeesByOwner').mockResolvedValue([
      { id: OWNER, isActive: true, is_email_verified: false, deletedAt: null },
      { id: 'ok', isActive: true, is_email_verified: true, deletedAt: null },
      { id: 'sin-verificar', isActive: true, is_email_verified: false },
      { id: 'inactivo', isActive: false, is_email_verified: true },
    ] as any);
    const result = await service.getActiveEmployeesByOwner(OWNER);
    expect(result.map((u: any) => u.id)).toEqual([OWNER, 'ok']);
  });

  it('emailChanges: solo un email distinto cuenta (mayúsculas y espacios no)', () => {
    expect(emailChanges('ana@test.co', 'otra@test.co')).toBe(true);
    expect(emailChanges('ana@test.co', ' ANA@test.co ')).toBe(false);
    expect(emailChanges('ana@test.co', undefined)).toBe(false);
    expect(emailChanges('ana@test.co', '')).toBe(false);
  });

  it('PATCH con email nuevo: el empleado queda sin verificar e inactivo y sin código vigente', async () => {
    const current = {
      ...employee(true, { isActive: true }),
      email: 'ana@test.co',
      phone: '3000000000',
    };
    const saved: any[] = [];
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ ...current }) // el empleado
        .mockResolvedValueOnce(null) // nadie más con ese email
        .mockImplementation(async () => ({ ...saved[0], roles: [] })),
      save: jest.fn(async (x) => {
        saved.push({ ...x });
        return x;
      }),
    };
    const dataSource = { transaction: jest.fn((cb) => cb(manager)) };
    const service = new EmployeesService(
      {} as any,
      {} as any,
      dataSource as any,
      {} as any,
    );
    await service.updateEmployee(OWNER, EMPLOYEE, {
      email: 'nuevo@test.co',
    } as any);
    expect(saved[0]).toMatchObject({
      email: 'nuevo@test.co',
      isActive: false,
      is_email_verified: false,
      verification_code: null,
      verification_code_expires: null,
    });

    // Otros cambios (o el mismo email) no tocan la verificación.
    saved.length = 0;
    manager.findOne
      .mockReset()
      .mockResolvedValueOnce({ ...current })
      .mockResolvedValueOnce(null) // el email solo cambia de mayúsculas
      .mockImplementation(async () => ({ ...saved[0], roles: [] }));
    await service.updateEmployee(OWNER, EMPLOYEE, {
      email: 'ANA@test.co',
      name: 'Ana María',
    } as any);
    expect(saved[0]).toMatchObject({ isActive: true, is_email_verified: true });
  });
});
