import { Logger } from '@nestjs/common';
import { PaymentStatsService } from './payment-stats.service';

/**
 * 10.01b: un pago guardado en revisión (`review_required`) no cuenta en el
 * saldo de la cita ni en NINGUNA estadística hasta resolverlo. Y los rankings
 * de clientes desempatan por id para que el `LIMIT` no elija al azar.
 */
const TENANT = 'a0000000-0000-4000-8000-0000000000aa';
const DAY = new Date('2030-01-07T05:00:00.000Z');

function build() {
  const sql: string[] = [];
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
    'addOrderBy',
    'limit',
  ]) {
    qb[m] = jest.fn((s: unknown) => {
      sql.push(`${m}:${String(s)}`);
      return qb;
    });
  }
  qb.getRawOne = jest.fn(async () => ({}));
  qb.getRawMany = jest.fn(async () => []);
  const query = jest.fn<Promise<any[]>, [string, unknown[]]>(async () => []);
  const repo = { createQueryBuilder: jest.fn(() => qb), manager: { query } };
  const settings = { getTimezone: jest.fn(async () => 'America/Bogota') };
  const service = new PaymentStatsService(repo as any, settings as any);
  return { service, sql, query };
}

const calls: [string, (s: PaymentStatsService) => Promise<unknown>][] = [
  ['getPaymentStats', (s) => s.getPaymentStats(DAY, DAY, TENANT)],
  ['getEmployeeStats', (s) => s.getEmployeeStats('pro', DAY, DAY, TENANT)],
  [
    'getPaymentStatsByMethod',
    (s) => s.getPaymentStatsByMethod(DAY, DAY, TENANT),
  ],
  [
    'getPaymentStatsComparison',
    (s) => s.getPaymentStatsComparison(DAY, DAY, TENANT),
  ],
  [
    'getPaymentStatsByService',
    (s) => s.getPaymentStatsByService(DAY, DAY, TENANT),
  ],
  [
    'getPaymentStatsByProfessional',
    (s) => s.getPaymentStatsByProfessional(DAY, DAY, TENANT),
  ],
  [
    'getPaymentStatsByClient',
    (s) => s.getPaymentStatsByClient(DAY, DAY, TENANT),
  ],
  ['getTopClients', (s) => s.getTopClients(DAY, DAY, TENANT)],
];

describe('PaymentStatsService: pagos en revisión y desempate estable', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it.each(calls)(
    '%s: cada consulta de pagos COMPLETED excluye los que están en revisión',
    async (_name, run) => {
      const { service, sql, query } = build();
      await run(service);
      const completedQb = sql.filter((s) =>
        s.includes('payment.status = :status'),
      );
      const reviewQb = sql.filter(
        (s) => s === 'andWhere:payment.reviewRequired IS NULL',
      );
      expect(reviewQb).toHaveLength(completedQb.length);
      const raw = query.mock.calls.map(([q]) => q);
      for (const q of raw.filter((q) => q.includes("p.status = 'COMPLETED'"))) {
        expect(q).toContain(
          "p.status = 'COMPLETED' AND p.review_required IS NULL",
        );
      }
      // Ninguna consulta se queda sin revisar: cada método toca pagos.
      expect(completedQb.length + raw.length).toBeGreaterThan(0);
    },
  );

  it('mejores clientes: ORDER BY total DESC y luego id (LIMIT estable)', async () => {
    const { service, query } = build();
    await service.getTopClients(DAY, DAY, TENANT, 3);
    const [q] = query.mock.calls
      .map(([s]) => s)
      .filter((s) => s.includes('LIMIT'));
    expect(q.replace(/\s+/g, ' ')).toMatch(
      /ORDER BY total_spent DESC, c\.id ASC LIMIT \$\d/,
    );
  });

  it('estadísticas por cliente: desempata por client.id antes del limit', async () => {
    const { service, sql } = build();
    await service.getPaymentStatsByClient(DAY, DAY, TENANT, 3);
    const i = sql.indexOf('addOrderBy:client.id');
    expect(i).toBeGreaterThan(sql.indexOf('orderBy:total_spent'));
    expect(i).toBeLessThan(sql.indexOf('limit:3'));
  });
});
