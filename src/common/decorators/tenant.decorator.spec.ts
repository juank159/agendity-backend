import { UnauthorizedException } from '@nestjs/common';
import { AuthUser, isOnlyEmployee } from 'src/auth/interfaces';
import {
  appointmentScopeOf,
  toAppointmentScope,
} from 'src/appointments/appointment-scope';
import { tenantIdFrom } from './tenant.decorator';

const OWNER = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const EMPLOYEE = '0f2ac72d-a104-4782-81c0-1178c7503c54';

const user = (over: Partial<AuthUser>): AuthUser => ({
  id: OWNER,
  name: 'n',
  email: 'e@x.co',
  roles: ['Owner'],
  tenantId: OWNER,
  ownerId: OWNER,
  ...over,
});

describe('tenantIdFrom (@Tenant)', () => {
  it('devuelve el tenant del Owner y el del owner para el Employee', () => {
    expect(tenantIdFrom(user({}))).toBe(OWNER);
    expect(tenantIdFrom(user({ id: EMPLOYEE, roles: ['Employee'] }))).toBe(
      OWNER,
    );
  });

  it('lanza 401 si no hay usuario o tenant (nunca consulta sin tenant)', () => {
    expect(() => tenantIdFrom(undefined)).toThrow(UnauthorizedException);
    expect(() => tenantIdFrom(user({ tenantId: undefined }))).toThrow(
      UnauthorizedException,
    );
    expect(() => tenantIdFrom(user({ tenantId: '' }))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('isOnlyEmployee', () => {
  it('solo es verdadero para Employee sin Owner', () => {
    expect(isOnlyEmployee({ roles: ['Employee'] })).toBe(true);
    expect(isOnlyEmployee({ roles: ['Employee', 'Owner'] })).toBe(false);
    expect(isOnlyEmployee({ roles: ['Owner'] })).toBe(false);
    expect(isOnlyEmployee({ roles: [] })).toBe(false);
  });
});

describe('appointmentScopeOf', () => {
  it('Owner: todas las citas del negocio', () => {
    expect(appointmentScopeOf(user({}))).toEqual({ tenantId: OWNER });
  });

  it('Employee: las del negocio donde es el profesional', () => {
    expect(
      appointmentScopeOf(user({ id: EMPLOYEE, roles: ['Employee'] })),
    ).toEqual({ tenantId: OWNER, professionalId: EMPLOYEE });
  });

  it('toAppointmentScope acepta un tenant suelto', () => {
    expect(toAppointmentScope(OWNER)).toEqual({ tenantId: OWNER });
    const scope = { tenantId: OWNER, professionalId: EMPLOYEE };
    expect(toAppointmentScope(scope)).toBe(scope);
  });
});
