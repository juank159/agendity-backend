import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createHash } from 'crypto';
import { WompiService } from './wompi.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SECRETS = {
  WOMPI_PUBLIC_KEY: 'pub_test_x',
  WOMPI_PRIVATE_KEY: 'prv_test_x',
  WOMPI_EVENT_INTEGRITY_SECRET: 'integrity_x',
};

function build(env: Record<string, string | undefined>): WompiService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new WompiService(config);
}

describe('WompiService: atajos solo con NODE_ENV=development', () => {
  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => {
    jest.resetAllMocks();
    mockedAxios.get.mockRejectedValue(new Error('red caída'));
    mockedAxios.post.mockRejectedValue(new Error('red caída'));
  });

  // [NODE_ENV, ¿atajos?]. production necesita los secretos para arrancar.
  const cases: Array<[string | undefined, boolean]> = [
    ['development', true],
    ['production', false],
    ['test', false],
    ['staging', false],
    ['', false],
    [undefined, false],
  ];

  describe.each(cases)('NODE_ENV=%p', (nodeEnv, shortcuts) => {
    const env = (extra: Record<string, string> = {}) => ({
      NODE_ENV: nodeEnv,
      ...(nodeEnv === 'production' ? SECRETS : {}),
      ...extra,
    });

    it(`devShortcutsEnabled = ${shortcuts}`, () => {
      expect(build(env()).devShortcutsEnabled).toBe(shortcuts);
    });

    it(`WOMPI_MODE=stub ${shortcuts ? 'acepta' : 'NO acepta'} un webhook sin firma`, async () => {
      const service = build(env({ WOMPI_MODE: 'stub' }));
      expect(service.verifyWebhookEvent({ event: 'x', data: {} }, '')).toBe(
        shortcuts,
      );
    });

    it(`si Wompi falla, ${shortcuts ? 'da un enlace myapp://payment-demo' : 'propaga el error'}`, async () => {
      const service = build(env());
      const result = service.createPaymentLink(
        1000,
        'Plan',
        'myapp://payment-callback',
        'sub_1',
      );
      if (shortcuts) {
        await expect(result).resolves.toMatch(/^myapp:\/\/payment-demo\?/);
      } else {
        await expect(result).rejects.toThrow();
      }
    });

    it(`si la consulta de la transacción falla, ${shortcuts ? 'devuelve null (decide el atajo de refresh-status)' : 'propaga el error'}`, async () => {
      const service = build(env());
      const result = service.findLatestTransactionByReference('sub_1');
      if (shortcuts) {
        await expect(result).resolves.toBeNull();
      } else {
        await expect(result).rejects.toThrow();
      }
    });
  });

  describe('verifyWebhookEvent con el secreto de eventos', () => {
    const secret = SECRETS.WOMPI_EVENT_INTEGRITY_SECRET;
    const signed = (checksumOf: string) => ({
      event: 'transaction.updated',
      data: { transaction: { id: 'tx-9', status: 'APPROVED' } },
      timestamp: 1700000000,
      signature: {
        properties: ['transaction.id', 'transaction.status'],
        checksum: createHash('sha256').update(checksumOf).digest('hex'),
      },
    });

    it.each(['production', 'test', 'development'])(
      'NODE_ENV=%p: valida con el algoritmo de Wompi (SHA256, no HMAC)',
      (nodeEnv) => {
        const service = build({ NODE_ENV: nodeEnv, ...SECRETS });
        expect(
          service.verifyWebhookEvent(signed(`tx-9APPROVED1700000000${secret}`)),
        ).toBe(true);
        expect(
          service.verifyWebhookEvent(signed(`tx-9APPROVED1700000001${secret}`)),
        ).toBe(false);
      },
    );

    it('sin secreto configurado rechaza (fuera del stub)', () => {
      const service = build({ NODE_ENV: 'test' });
      expect(service.verifyWebhookEvent(signed(`tx-9APPROVED1700000000`))).toBe(
        false,
      );
    });
  });

  describe('findLatestTransactionByReference', () => {
    it('devuelve la transacción más reciente de esa referencia, con la llave privada', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          data: [
            {
              id: 'a',
              status: 'DECLINED',
              amount_in_cents: 1,
              currency: 'COP',
              reference: 'sub_1',
              created_at: '2026-10-22T10:00:00Z',
            },
            {
              id: 'b',
              status: 'APPROVED',
              amount_in_cents: 1,
              currency: 'COP',
              reference: 'sub_1',
              created_at: '2026-10-22T11:00:00Z',
            },
            {
              id: 'c',
              status: 'APPROVED',
              amount_in_cents: 1,
              currency: 'COP',
              reference: 'otra',
              created_at: '2026-10-22T12:00:00Z',
            },
          ],
        },
      });
      const service = build({ NODE_ENV: 'test', ...SECRETS });
      await expect(
        service.findLatestTransactionByReference('sub_1'),
      ).resolves.toMatchObject({ id: 'b', status: 'APPROVED' });
      const [, options] = mockedAxios.get.mock.calls[0];
      expect(options).toMatchObject({
        params: { reference: 'sub_1' },
        headers: { Authorization: `Bearer ${SECRETS.WOMPI_PRIVATE_KEY}` },
      });
    });

    it('sin transacciones → null', async () => {
      mockedAxios.get.mockResolvedValue({ data: { data: [] } });
      const service = build({ NODE_ENV: 'test', ...SECRETS });
      await expect(
        service.findLatestTransactionByReference('sub_1'),
      ).resolves.toBeNull();
    });
  });

  describe('arranque en producción', () => {
    it('falla si falta algún secreto y dice cuáles', () => {
      expect(() =>
        build({
          NODE_ENV: 'production',
          WOMPI_PUBLIC_KEY: 'pub',
        }),
      ).toThrow(/Faltan: WOMPI_PRIVATE_KEY, WOMPI_EVENT_INTEGRITY_SECRET$/);
    });

    it('arranca con los tres secretos', () => {
      expect(() => build({ NODE_ENV: 'production', ...SECRETS })).not.toThrow();
    });

    it.each(['test', 'development', undefined])(
      'NODE_ENV=%p no exige los secretos',
      (nodeEnv) => {
        expect(() => build({ NODE_ENV: nodeEnv })).not.toThrow();
      },
    );
  });
});
