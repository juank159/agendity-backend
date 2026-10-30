import { ForbiddenException } from '@nestjs/common';
import { CommissionSettlementService } from './commission-settlement.service';

describe('CommissionSettlementService (8.02)', () => {
  const TENANT = 't1';
  const build = () => {
    const query = jest.fn<Promise<any[]>, [string, unknown[]]>(async () => [
      {
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
      },
    ]);
    const settings = { getTimezone: jest.fn(async () => 'America/Caracas') };
    const service = new CommissionSettlementService(
      { query } as any,
      settings as any,
    );
    return { service, query };
  };
  const day = (ymd: string) => new Date(`${ymd}T04:00:00Z`); // 00:00 Caracas

  it('solo citas COMPLETED del negocio, días completos en su zona, y totales', async () => {
    const { service, query } = build();
    const result = await service.settle(
      TENANT,
      day('2030-01-07'),
      day('2030-01-07'),
      {},
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.status = 'COMPLETED'");
    expect(sql).toContain('a.owner_id = $1');
    expect(params[0]).toBe(TENANT);
    expect((params[1] as Date).toISOString()).toBe('2030-01-07T04:00:00.000Z');
    expect((params[2] as Date).toISOString()).toBe('2030-01-08T03:59:59.999Z');
    expect(params[3]).toBeNull();
    expect(result.timezone).toBe('America/Caracas');
    expect(result.totals).toMatchObject({
      services_total: 180000,
      professional_total: 54000,
      business_total: 126000,
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
