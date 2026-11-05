import { ForbiddenException } from '@nestjs/common';
import { CommissionSettlementService } from './commission-settlement.service';

describe('CommissionSettlementService (8.02, D-27)', () => {
  const TENANT = 't1';
  const line = (overrides: Record<string, unknown> = {}) => ({
    appointmentId: 'a1',
    date: new Date('2030-01-07T15:00:00Z'),
    timezone: 'America/Bogota',
    clientName: 'Cliente',
    professionalId: 'ana',
    professionalName: 'Ana',
    serviceId: 's1',
    serviceName: 'Pelo a pelo',
    price: '180000.00',
    commissionPercentage: '30.00',
    status: 'COMPLETED',
    paymentStatus: 'COMPLETED',
    paidAmount: '180000.00',
    ...overrides,
  });
  const build = (rows: any[] = [line()]) => {
    const query = jest.fn<Promise<any[]>, [string, unknown[]]>(
      async () => rows,
    );
    const settings = { getTimezone: jest.fn(async () => 'America/Caracas') };
    const service = new CommissionSettlementService(
      { query } as any,
      settings as any,
    );
    return { service, query };
  };
  const day = (ymd: string) => new Date(`${ymd}T04:00:00Z`); // 00:00 Caracas
  const mixedRows = () => [
    line(),
    line({
      appointmentId: 'a2',
      date: new Date('2030-01-07T17:00:00Z'),
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paidAmount: '0',
      price: '50000.00',
      commissionPercentage: '40.00',
    }),
    line({
      appointmentId: 'a3',
      date: new Date('2030-01-07T19:00:00Z'),
      status: 'CONFIRMED',
      paymentStatus: 'PARTIAL',
      paidAmount: '20000.00',
      price: '100000.00',
      commissionPercentage: '30.00',
    }),
  ];
  /** Todas las claves de un objeto JSON, a cualquier profundidad. */
  const keysDeep = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysDeep)
      : value && typeof value === 'object' && !(value instanceof Date)
        ? Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)])
        : [];

  it('consulta las citas del negocio COMPLETED, PENDING y CONFIRMED, días completos en su zona', async () => {
    const { service, query } = build();
    const result = await service.settle(
      TENANT,
      day('2030-01-07'),
      day('2030-01-07'),
      {},
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('a.status::text = ANY($5::text[])');
    expect(sql).toContain('a.owner_id = $1');
    expect(sql).toContain('p.review_required IS NULL');
    expect(params[0]).toBe(TENANT);
    expect((params[1] as Date).toISOString()).toBe('2030-01-07T04:00:00.000Z');
    expect((params[2] as Date).toISOString()).toBe('2030-01-08T03:59:59.999Z');
    expect(params[3]).toBeNull();
    expect(params[4]).toEqual(['COMPLETED', 'PENDING', 'CONFIRMED']);
    expect(result.timezone).toBe('America/Caracas');
    expect(result.totals).toMatchObject({
      services_total: 180000,
      professional_total: 54000,
      business_total: 126000,
    });
  });

  it('Owner: lo ganado (COMPLETED) sin cambios y lo por ganar en `pending` con estado y pagado', async () => {
    const { service } = build(mixedRows());
    const result = await service.settle(
      TENANT,
      day('2030-01-07'),
      day('2030-01-07'),
      {},
    );
    // Nivel principal: solo la COMPLETED y sin los campos de `pending`.
    expect(result.totals).toEqual({
      services_total: 180000,
      professional_total: 54000,
      business_total: 126000,
      appointment_count: 1,
    });
    const earnedAppt = result.professionals[0].appointments[0];
    expect(earnedAppt.appointment_id).toBe('a1');
    expect(earnedAppt).not.toHaveProperty('status');
    expect(earnedAppt).not.toHaveProperty('payment_status');
    expect(earnedAppt).not.toHaveProperty('paid_amount');

    // `pending`: misma forma, con PENDING y CONFIRMED.
    expect(result.pending.totals).toEqual({
      services_total: 150000,
      professional_total: 50000, // 50.000 × 40 % + 100.000 × 30 %
      business_total: 100000,
      appointment_count: 2,
    });
    const [pro] = result.pending.professionals;
    expect(pro).toMatchObject({
      professional_id: 'ana',
      appointment_count: 2,
      business_total: 100000,
    });
    expect(pro.appointments).toEqual([
      expect.objectContaining({
        appointment_id: 'a2',
        status: 'PENDING',
        payment_status: 'PENDING',
        paid_amount: 0,
        services_total: 50000,
        professional_total: 20000,
        business_total: 30000,
        lines: [expect.objectContaining({ commission_percentage: 40 })],
      }),
      expect.objectContaining({
        appointment_id: 'a3',
        status: 'CONFIRMED',
        payment_status: 'PARTIAL',
        paid_amount: 20000,
      }),
    ]);
  });

  it('sin citas por ganar: `pending` vacío con totales en cero', async () => {
    const { service } = build();
    const result = await service.settle(
      TENANT,
      day('2030-01-07'),
      day('2030-01-07'),
      {},
    );
    expect(result.pending).toEqual({
      totals: {
        services_total: 0,
        professional_total: 0,
        business_total: 0,
        appointment_count: 0,
      },
      professionals: [],
    });
  });

  it('Employee: sin `business_total` en ningún nivel (tampoco en `pending`)', async () => {
    const { service } = build(mixedRows());
    const result = await service.settle(
      TENANT,
      day('2030-01-07'),
      day('2030-01-07'),
      { onlyProfessionalId: 'ana' },
    );
    expect(keysDeep(result)).not.toContain('business_total');
    expect(result.totals).toEqual({
      services_total: 180000,
      professional_total: 54000,
      appointment_count: 1,
    });
    expect(result.pending.totals).toEqual({
      services_total: 150000,
      professional_total: 50000,
      appointment_count: 2,
    });
    expect(result.pending.professionals[0].appointments[1]).toMatchObject({
      status: 'CONFIRMED',
      payment_status: 'PARTIAL',
      paid_amount: 20000,
      professional_total: 30000,
    });
  });

  it('Employee: solo lo suyo; pedir otro profesional → 403', async () => {
    const { service, query } = build();
    await service.settle(TENANT, day('2030-01-07'), day('2030-01-07'), {
      onlyProfessionalId: 'ana',
    });
    expect(query.mock.calls[0][1][3]).toBe('ana');
    await expect(
      service.settle(TENANT, day('2030-01-07'), day('2030-01-07'), {
        onlyProfessionalId: 'ana',
        professionalId: 'laura',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
