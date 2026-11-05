import {
  commissionCents,
  effectiveCommission,
  settleCommissions,
  SettlementLine,
  withoutBusinessShare,
} from './appointment-commission';

describe('comisiones (8.02, D-16)', () => {
  it('% efectivo: excepción por servicio (también 0) > general > 0', () => {
    expect(effectiveCommission('40.00', '30.00')).toBe('40.00');
    expect(effectiveCommission(0, '30.00')).toBe('0.00');
    expect(effectiveCommission(null, '30.00')).toBe('30.00');
    expect(effectiveCommission(undefined, undefined)).toBe('0.00');
  });

  it('comisión de una línea redondeada al centavo', () => {
    expect(commissionCents('180000.00', '30.00')).toBe(5_400_000);
    expect(commissionCents('99.99', '33.33')).toBe(3333); // 33,326… → 33,33
    expect(commissionCents('25000', '0')).toBe(0);
  });

  it('liquidación: por profesional y cita; profesional + negocio = total', () => {
    const line = (
      over: Partial<SettlementLine> & Pick<SettlementLine, 'price'>,
    ): SettlementLine => ({
      appointmentId: 'a1',
      date: new Date('2030-01-07T15:00:00Z'),
      timezone: 'America/Bogota',
      clientName: 'Cliente',
      professionalId: 'ana',
      professionalName: 'Ana',
      serviceId: 's1',
      serviceName: 'Pelo a pelo',
      commissionPercentage: '30.00',
      ...over,
    });
    const result = settleCommissions([
      line({ price: '150000.00' }),
      line({ appointmentId: 'a2', serviceId: 's2', price: '40000.00' }),
      line({
        appointmentId: 'a3',
        professionalId: 'laura',
        professionalName: 'Laura',
        price: '160000.00',
        commissionPercentage: '50.00',
      }),
    ]);
    expect(result.totals).toEqual({
      services_total: 350000,
      professional_total: 137000,
      business_total: 213000,
      appointment_count: 3,
    });
    const [ana, laura] = result.professionals;
    expect(ana).toMatchObject({
      professional_name: 'Ana',
      appointment_count: 2,
      services_total: 190000,
      professional_total: 57000,
      business_total: 133000,
    });
    expect(ana.appointments[0].lines[0]).toEqual({
      service_id: 's1',
      service_name: 'Pelo a pelo',
      price: 150000,
      commission_percentage: 30,
      commission: 45000,
    });
    expect(laura).toMatchObject({
      professional_total: 80000,
      business_total: 80000,
    });
  });
});

describe('comisiones por ganar y vista del Employee (D-27)', () => {
  const line = (overrides: Partial<SettlementLine> = {}): SettlementLine => ({
    appointmentId: 'a1',
    date: new Date('2030-01-07T15:00:00Z'),
    timezone: 'America/Bogota',
    clientName: 'Cliente',
    professionalId: 'ana',
    professionalName: 'Ana',
    serviceId: 's1',
    serviceName: 'Corte',
    price: '50000.00',
    commissionPercentage: '40.00',
    status: 'CONFIRMED' as any,
    paymentStatus: 'PARTIAL' as any,
    paidAmount: '10000.50',
    ...overrides,
  });

  it('withState: cada cita lleva su estado, estado de pago y pagado neto (una vez por cita)', () => {
    const result = settleCommissions(
      [line(), line({ serviceId: 's2', serviceName: 'Barba' })],
      { withState: true },
    );
    const [appt] = result.professionals[0].appointments;
    expect(appt).toMatchObject({
      status: 'CONFIRMED',
      payment_status: 'PARTIAL',
      paid_amount: 10000.5,
      services_total: 100000,
      professional_total: 40000,
      business_total: 60000,
    });
    expect(appt.lines).toHaveLength(2);
    // Sin la opción (lo ganado), la cita sale como siempre.
    const plain = settleCommissions([line()]).professionals[0].appointments[0];
    expect(plain).not.toHaveProperty('status');
    expect(plain).not.toHaveProperty('paid_amount');
  });

  it('withoutBusinessShare quita la clave business_total en todos los niveles (no la deja null)', () => {
    const full = settleCommissions([line()], { withState: true });
    const employee = withoutBusinessShare(full);
    expect(JSON.stringify(employee)).not.toContain('business_total');
    expect(employee.totals).toEqual({
      services_total: 50000,
      professional_total: 20000,
      appointment_count: 1,
    });
    expect(employee.professionals[0]).toMatchObject({
      professional_id: 'ana',
      services_total: 50000,
      professional_total: 20000,
    });
    expect(employee.professionals[0].appointments[0]).toMatchObject({
      status: 'CONFIRMED',
      paid_amount: 10000.5,
      lines: [expect.objectContaining({ commission: 20000 })],
    });
    // No muta la liquidación original (la del Owner).
    expect(full.totals.business_total).toBe(30000);
  });
});
