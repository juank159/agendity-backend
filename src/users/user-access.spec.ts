import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import {
  assertUserInTenant,
  canBeScheduled,
  tenantMembersWhere,
} from './user-access';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';
const STRANGER = '11111111-1111-4111-8111-111111111111';

function repoReturning(user: Partial<User> | null) {
  const findOne = jest.fn().mockResolvedValue(user);
  return { repo: { findOne } as unknown as Repository<User>, findOne };
}

describe('tenantMembersWhere', () => {
  it('es el Owner o sus empleados', () => {
    expect(tenantMembersWhere(TENANT)).toEqual([
      { id: TENANT },
      { owner: { id: TENANT } },
    ]);
  });

  it('sin tenant lanza (TypeORM ignoraría `id: undefined`)', () => {
    expect(() => tenantMembersWhere(undefined)).toThrow(NotFoundException);
    expect(() => tenantMembersWhere('')).toThrow(NotFoundException);
  });
});

describe('assertUserInTenant', () => {
  it('el propio Owner del tenant', async () => {
    const { repo, findOne } = repoReturning({ id: TENANT });
    await expect(assertUserInTenant(repo, TENANT, TENANT)).resolves.toEqual({
      id: TENANT,
    });
    expect(findOne).toHaveBeenCalledWith({ where: { id: TENANT } });
  });

  it('un empleado: lo busca filtrando por su owner', async () => {
    const { repo, findOne } = repoReturning({ id: EMPLOYEE });
    await assertUserInTenant(repo, TENANT, EMPLOYEE);
    expect(findOne).toHaveBeenCalledWith({
      where: { id: EMPLOYEE, owner: { id: TENANT } },
    });
  });

  it('usuario de otro negocio o inexistente: 404', async () => {
    const { repo } = repoReturning(null);
    await expect(assertUserInTenant(repo, TENANT, STRANGER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('id inválido o sin tenant: 404 sin consultar', async () => {
    const { repo, findOne } = repoReturning({ id: EMPLOYEE });
    await expect(assertUserInTenant(repo, TENANT, 'no-uuid')).rejects.toThrow(
      NotFoundException,
    );
    await expect(assertUserInTenant(repo, '', EMPLOYEE)).rejects.toThrow(
      NotFoundException,
    );
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe('canBeScheduled: a quién se le pueden agendar citas (2.33)', () => {
  const OWNER_ID = TENANT;
  const base = { isActive: true, deletedAt: null, is_email_verified: true };

  it('empleado activo, sin borrar y verificado: sí', () => {
    expect(canBeScheduled({ id: EMPLOYEE, ...base }, OWNER_ID)).toBe(true);
  });

  it('empleado sin verificar, inactivo o borrado: no', () => {
    for (const change of [
      { is_email_verified: false },
      { isActive: false },
      { deletedAt: new Date() },
    ]) {
      expect(
        canBeScheduled({ id: EMPLOYEE, ...base, ...change }, OWNER_ID),
      ).toBe(false);
    }
    expect(canBeScheduled(null, OWNER_ID)).toBe(false);
  });

  it('el Owner con el email sin verificar sí (puede entrar sin verificar); inactivo, no', () => {
    expect(
      canBeScheduled(
        { id: OWNER_ID, ...base, is_email_verified: false },
        OWNER_ID,
      ),
    ).toBe(true);
    expect(
      canBeScheduled({ id: OWNER_ID, ...base, isActive: false }, OWNER_ID),
    ).toBe(false);
  });
});
