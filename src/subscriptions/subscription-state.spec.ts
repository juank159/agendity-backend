import {
  appointmentAllowance,
  effectiveStatus,
  paidPlanLimit,
  planPeriodEnd,
  SUBSCRIPTION_MESSAGES,
  TRIAL_APPOINTMENTS_LIMIT,
} from './subscription-state';

const BOGOTA = 'America/Bogota';

const NOW = new Date('2026-10-22T12:00:00');
const PAST = new Date('2025-11-05T16:49:28');
const FUTURE = new Date('2027-01-01T00:00:00');

function sub(overrides: Record<string, any> = {}): any {
  return {
    status: 'trial',
    trial_appointments_used: 0,
    trial_appointments_limit: 20,
    subscription_end_date: null,
    plan: null,
    ...overrides,
  };
}
const unlimitedPlan = { appointment_limit: -1, duration_months: 1 };

describe('Estado efectivo de la suscripción (2.03)', () => {
  it('sin fila: trial sin usar, puede crear 20 citas', () => {
    expect(effectiveStatus(null, NOW)).toBe('trial');
    expect(appointmentAllowance(null, NOW)).toEqual({
      canCreateAppointment: true,
      message: `Citas restantes en prueba: ${TRIAL_APPOINTMENTS_LIMIT}`,
    });
  });

  it.each([
    [0, 20],
    [10, 10],
    [19, 1],
  ])('trial con %i citas usadas: puede crear (%i restantes)', (used, left) => {
    expect(
      appointmentAllowance(sub({ trial_appointments_used: used }), NOW),
    ).toEqual({
      canCreateAppointment: true,
      message: `Citas restantes en prueba: ${left}`,
    });
  });

  it.each([20, 25])(
    'trial con %i citas usadas: TRIAL_LIMIT_REACHED con el texto que compara la app',
    (used) => {
      const result = appointmentAllowance(
        sub({ trial_appointments_used: used }),
        NOW,
      );
      expect(result).toEqual({
        canCreateAppointment: false,
        code: 'TRIAL_LIMIT_REACHED',
        message: SUBSCRIPTION_MESSAGES.trialLimitReached,
      });
      expect(result.message).toContain('límite de citas');
      expect(result.message).toContain('adquiere un plan');
    },
  );

  it('activa e ilimitada (-1): puede crear', () => {
    const s = sub({
      status: 'active',
      plan: unlimitedPlan,
      subscription_end_date: FUTURE,
    });
    expect(effectiveStatus(s, NOW)).toBe('active');
    expect(paidPlanLimit(s, NOW)).toBeNull();
    expect(appointmentAllowance(s, NOW)).toEqual({
      canCreateAppointment: true,
      message: 'Plan activo con citas ilimitadas',
    });
  });

  it('activa sin fecha de fin: sigue activa', () => {
    const s = sub({ status: 'active', plan: unlimitedPlan });
    expect(effectiveStatus(s, NOW)).toBe('active');
    expect(appointmentAllowance(s, NOW).canCreateAppointment).toBe(true);
  });

  it('activa con la fecha de fin pasada: se informa como vencida sin tocar la fila', () => {
    const s = sub({
      status: 'active',
      plan: unlimitedPlan,
      subscription_end_date: PAST,
    });
    expect(effectiveStatus(s, NOW)).toBe('expired');
    expect(appointmentAllowance(s, NOW)).toEqual({
      canCreateAppointment: false,
      code: 'SUBSCRIPTION_INACTIVE',
      message: SUBSCRIPTION_MESSAGES.expired,
    });
    expect(s.status).toBe('active');
  });

  it('vencida ya guardada (cron) responde lo mismo que la calculada', () => {
    const s = sub({
      status: 'expired',
      plan: unlimitedPlan,
      subscription_end_date: PAST,
    });
    expect(appointmentAllowance(s, NOW)).toEqual(
      appointmentAllowance(
        sub({
          status: 'active',
          plan: unlimitedPlan,
          subscription_end_date: PAST,
        }),
        NOW,
      ),
    );
  });

  // `canceled` con fecha futura sigue vigente (2.15): aquí, ya vencida.
  it.each([
    ['canceled', PAST],
    ['pending', FUTURE],
    ['past_due', FUTURE],
  ])(
    '%s: SUBSCRIPTION_INACTIVE con el texto que compara la app',
    (status, end) => {
      const result = appointmentAllowance(
        sub({ status, plan: unlimitedPlan, subscription_end_date: end }),
        NOW,
      );
      expect(result).toEqual({
        canCreateAppointment: false,
        code: 'SUBSCRIPTION_INACTIVE',
        message: SUBSCRIPTION_MESSAGES.inactive,
      });
      expect(result.message).toContain('suscripción no está activa');
    },
  );

  it('activa sin plan: inactiva', () => {
    expect(
      appointmentAllowance(sub({ status: 'active' }), NOW).canCreateAppointment,
    ).toBe(false);
  });

  it('plan pagado con límite: cuenta las citas del periodo', () => {
    const s = sub({
      status: 'active',
      plan: { appointment_limit: 100, duration_months: 1 },
      subscription_end_date: FUTURE,
    });
    expect(paidPlanLimit(s, NOW)).toBe(100);
    expect(appointmentAllowance(s, NOW, 99)).toEqual({
      canCreateAppointment: true,
      message: 'Citas restantes en tu plan: 1',
    });
    expect(appointmentAllowance(s, NOW, 100)).toEqual({
      canCreateAppointment: false,
      code: 'SUBSCRIPTION_INACTIVE',
      message: SUBSCRIPTION_MESSAGES.planLimitReached,
    });
  });

  it('un plan vencido no pide contar citas', () => {
    expect(
      paidPlanLimit(
        sub({
          status: 'active',
          plan: { appointment_limit: 5 },
          subscription_end_date: PAST,
        }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe('Duración del plan (duration_months)', () => {
  // Instantes explícitos en Bogotá: el resultado no depende de la zona del proceso.
  const bogota = (wall: string) => new Date(`${wall}-05:00`);

  it('el fin del periodo sale de duration_months, no del nombre', () => {
    const start = bogota('2026-10-22T10:00:00');
    expect(
      planPeriodEnd(
        start,
        { duration_months: 6, name: 'Mensual' } as any,
        BOGOTA,
      ),
    ).toEqual(bogota('2027-04-22T10:00:00'));
    expect(
      planPeriodEnd(
        start,
        { duration_months: 1, name: 'Anual' } as any,
        BOGOTA,
      ),
    ).toEqual(bogota('2026-11-22T10:00:00'));
    expect(
      planPeriodEnd(start, { duration_months: 12 } as any, BOGOTA),
    ).toEqual(bogota('2027-10-22T10:00:00'));
  });

  it('en la zona de cada negocio (6.02): 31 de enero 23:30 en Caracas = 1 de febrero en Bogotá', () => {
    // 2026-02-01T03:30Z: en Caracas (UTC-4) es 31 de enero 23:30; en Bogotá,
    // 31 de enero 22:30. Un mes después: fin de febrero en los dos, cada
    // uno a su hora de pared.
    const start = new Date('2026-02-01T03:30:00Z');
    expect(
      planPeriodEnd(start, { duration_months: 1 } as any, 'America/Caracas'),
    ).toEqual(new Date('2026-02-28T23:30:00-04:00'));
    expect(planPeriodEnd(start, { duration_months: 1 } as any, BOGOTA)).toEqual(
      new Date('2026-02-28T22:30:00-05:00'),
    );
  });

  it('una duración inválida cuenta como 1 mes', () => {
    const start = bogota('2026-10-22T10:00:00');
    for (const d of [0, -3, 1.5, null, undefined]) {
      expect(
        planPeriodEnd(start, { duration_months: d } as any, BOGOTA),
      ).toEqual(bogota('2026-11-22T10:00:00'));
    }
  });

  it('suma meses en el calendario del negocio, no en UTC', () => {
    // 30 de enero a las 21:00 en Bogotá ya es 31 de enero en UTC.
    expect(
      planPeriodEnd(
        bogota('2026-01-30T21:00:00'),
        {
          duration_months: 1,
        } as any,
        BOGOTA,
      ),
    ).toEqual(bogota('2026-02-28T21:00:00'));
  });
});

describe('Cancelada pero vigente (2.15)', () => {
  const {
    appointmentAllowance: allowance,
    effectiveStatus: effective,
    isCanceledButCurrent,
  } = jest.requireActual('./subscription-state');
  const now = new Date('2026-10-22T12:00:00-05:00');
  const canceled = (end: string) => ({
    status: 'canceled',
    plan: { appointment_limit: -1 },
    subscription_end_date: new Date(end),
    trial_appointments_used: 20,
    trial_appointments_limit: 20,
  });

  it('antes del fin: estado efectivo active, marcada y deja agendar', () => {
    const sub = canceled('2026-11-01T00:00:00-05:00');
    expect(isCanceledButCurrent(sub, now)).toBe(true);
    expect(effective(sub, now)).toBe('active');
    expect(allowance(sub, now).canCreateAppointment).toBe(true);
  });

  it('después del fin: canceled y no deja agendar', () => {
    const sub = canceled('2026-10-01T00:00:00-05:00');
    expect(isCanceledButCurrent(sub, now)).toBe(false);
    expect(effective(sub, now)).toBe('canceled');
    expect(allowance(sub, now)).toMatchObject({
      canCreateAppointment: false,
      code: 'SUBSCRIPTION_INACTIVE',
    });
  });

  it('cancelada sin plan (trial cancelado): no está vigente', () => {
    const sub = { ...canceled('2026-11-01T00:00:00-05:00'), plan: null };
    expect(isCanceledButCurrent(sub, now)).toBe(false);
    expect(effective(sub, now)).toBe('canceled');
  });
});
