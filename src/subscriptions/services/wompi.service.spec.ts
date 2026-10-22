import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
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
      await expect(
        service.verifyWebhookEvent({ event: 'x' }, ''),
      ).resolves.toBe(shortcuts);
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

    it(`si la consulta de la transacción falla, ${shortcuts ? 'la da por APPROVED' : 'propaga el error'}`, async () => {
      const service = build(env());
      const result = service.checkLatestTransactionByReference('sub_1');
      if (shortcuts) {
        await expect(result).resolves.toBe('APPROVED');
      } else {
        await expect(result).rejects.toThrow();
      }
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
