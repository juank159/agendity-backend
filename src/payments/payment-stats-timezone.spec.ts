import { Logger } from '@nestjs/common';
import { parseQueryDate } from 'src/common/decorators/query-date.decorator';
import { PaymentStatsService } from './payment-stats.service';

/**
 * 6.02 (D-15): las estadísticas por día usan la zona de CADA negocio. Mismo
 * `startDate=2030-01-07&endDate=2030-01-07` en Bogotá (UTC-5) y Caracas
 * (UTC-4): rangos distintos y `daily_evolution` agrupado en su zona.
 */
const BOGOTA_TENANT = 'b0000000-0000-4000-8000-0000000000bb';
const CARACAS_TENANT = 'c0000000-0000-4000-8000-0000000000cc';
const ZONES: Record<string, string> = {
  [BOGOTA_TENANT]: 'America/Bogota',
  [CARACAS_TENANT]: 'America/Caracas',
};

function build() {
  const params: Record<string, unknown>[] = [];
  const qb: any = {};
  for (const m of [
    'where',
    'andWhere',
    'select',
    'addSelect',
    'innerJoin',
    'leftJoin',
    'groupBy',
    'addGroupBy',
    'orderBy',
  ]) {
    qb[m] = jest.fn((_sql: unknown, p?: Record<string, unknown>) => {
      if (p && typeof p === 'object') params.push(p);
      return qb;
    });
  }
  qb.getRawOne = jest.fn(async () => ({}));
  qb.getRawMany = jest.fn(async () => []);
  const query = jest.fn<Promise<any[]>, [string, unknown[]]>(async () => []);
  const repo = { createQueryBuilder: jest.fn(() => qb), manager: { query } };
  const settings = {
    getTimezone: jest.fn(async (tenantId: string) => ZONES[tenantId]),
  };
  const service = new PaymentStatsService(repo as any, settings as any);
  return { service, params, query };
}

/** Lo que hace `@QueryDate` con `?startDate=…&endDate=…` en la zona del tenant. */
const day = (value: string, tenantId: string) =>
  parseQueryDate(value, ZONES[tenantId]) as Date;

describe('PaymentStatsService: días del negocio en su zona (6.02)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it.each([
    [BOGOTA_TENANT, '2030-01-07T05:00:00.000Z', '2030-01-08T04:59:59.999Z'],
    [CARACAS_TENANT, '2030-01-07T04:00:00.000Z', '2030-01-08T03:59:59.999Z'],
  ])(
    'stats del día 2030-01-07 para %s: [00:00, 23:59:59.999] de su zona',
    async (tenantId, start, end) => {
      const { service, params } = build();
      await service.getPaymentStats(
        day('2030-01-07', tenantId),
        day('2030-01-07', tenantId),
        tenantId,
      );
      const range = params.find((p) => 'adjustedEndDate' in p) as any;
      expect(range.startDate.toISOString()).toBe(start);
      expect(range.adjustedEndDate.toISOString()).toBe(end);
    },
  );

  it.each([
    [BOGOTA_TENANT, 'America/Bogota', '2030-01-07T05:00:00.000Z'],
    [CARACAS_TENANT, 'America/Caracas', '2030-01-07T04:00:00.000Z'],
  ])(
    'daily_evolution de %s agrupa por día con AT TIME ZONE de su zona',
    async (tenantId, zone, start) => {
      const { service, query } = build();
      await service.getEmployeeStats(
        'pro',
        day('2030-01-07', tenantId),
        day('2030-01-07', tenantId),
        tenantId,
      );
      const daily = query.mock.calls.find(([sql]) =>
        sql.includes('AT TIME ZONE $5'),
      );
      expect(daily).toBeDefined();
      const [, args] = daily!;
      expect(args[0]).toBe(tenantId);
      expect(args[2]).toBe(start);
      expect(args[4]).toBe(zone);
    },
  );
});
