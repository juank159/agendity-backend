import { envProblems, validateEnv } from './env.validation';
import { corsOrigins, parseTrustProxy, swaggerEnabled } from './app.setup';
import { bookingUrl } from 'src/settings/tenant-settings.service';

const BASE = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'agendity',
  SECRET_KEY_JWT: 'secreto-de-desarrollo',
};
const PRODUCTION = {
  ...BASE,
  NODE_ENV: 'production',
  SECRET_KEY_JWT: 'x'.repeat(40),
  WOMPI_PUBLIC_KEY: 'pub_prod_x',
  WOMPI_PRIVATE_KEY: 'prv_prod_x',
  WOMPI_EVENT_INTEGRITY_SECRET: 'prod_integrity_x',
  WOMPI_REDIRECT_URL: 'https://agendity.app/pago',
  EMAIL_USER: 'agenda@agendity.app',
  EMAIL_PASSWORD: 'app-password',
  PUBLIC_BASE_URL: 'https://agendity.app',
};

describe('validación del .env (D.02)', () => {
  it('desarrollo: con BD y JWT basta', () => {
    expect(envProblems(BASE)).toEqual([]);
    expect(validateEnv(BASE)).toBe(BASE);
  });

  it('siempre: falta la BD o el JWT → no arranca y nombra las claves (vacía = ausente)', () => {
    const problems = envProblems({
      ...BASE,
      DB_PASSWORD: '',
      SECRET_KEY_JWT: undefined,
    });
    expect(problems).toEqual(['Falta DB_PASSWORD', 'Falta SECRET_KEY_JWT']);
    expect(() => validateEnv({ ...BASE, DB_HOST: '' })).toThrow(
      /Falta DB_HOST/,
    );
  });

  it('el mensaje nunca incluye valores, solo nombres de claves', () => {
    const secret = 'valor-super-secreto';
    let message = '';
    try {
      validateEnv({
        ...BASE,
        NODE_ENV: 'production',
        SECRET_KEY_JWT: secret,
        WOMPI_REDIRECT_URL: `http://${secret}.com`,
        PORT: secret,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('SECRET_KEY_JWT');
    expect(message).not.toContain(secret);
  });

  it('producción: exige Wompi, correo, URL pública https y JWT largo; sin stub', () => {
    expect(envProblems(PRODUCTION)).toEqual([]);
    const { WOMPI_PRIVATE_KEY, EMAIL_PASSWORD, ...missing } = PRODUCTION;
    void WOMPI_PRIVATE_KEY;
    void EMAIL_PASSWORD;
    expect(envProblems(missing)).toEqual([
      'Falta WOMPI_PRIVATE_KEY (obligatoria en producción)',
      'Falta EMAIL_PASSWORD (obligatoria en producción)',
    ]);
    expect(
      envProblems({
        ...PRODUCTION,
        SECRET_KEY_JWT: 'corto',
        WOMPI_REDIRECT_URL: 'http://agendity.app/pago',
        PUBLIC_BASE_URL: 'http://agendity.app',
        WOMPI_MODE: 'stub',
      }),
    ).toEqual([
      'WOMPI_REDIRECT_URL debe ser https en producción',
      'PUBLIC_BASE_URL debe ser https en producción',
      'SECRET_KEY_JWT debe tener al menos 32 caracteres en producción',
      'WOMPI_MODE=stub no se permite en producción',
    ]);
  });

  it('formatos: NODE_ENV, PORT, zona, booleanos, CORS, DB_SSL', () => {
    expect(
      envProblems({
        ...BASE,
        NODE_ENV: 'prod',
        PORT: 'abc',
        BUSINESS_TIMEZONE: 'Marte/Olympus',
        DB_MIGRATIONS_RUN: 'si',
        CORS_ORIGINS: 'agendity.app',
        DB_SSL: 'quizas',
      }),
    ).toEqual(
      expect.arrayContaining([
        'NODE_ENV debe ser development, production o test',
        'PORT debe ser un número',
        'BUSINESS_TIMEZONE no es una zona IANA válida',
        'DB_MIGRATIONS_RUN debe ser true o false',
        'CORS_ORIGINS debe ser una lista de URLs separadas por comas',
        'DB_SSL debe ser true, false o no-verify',
      ]),
    );
  });
});

describe('arranque de producción (D.02)', () => {
  it('TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe(
      'loopback, 10.0.0.0/8',
    );
  });

  it('CORS_ORIGINS: lista; sin la variable, sin CORS', () => {
    expect(corsOrigins(undefined)).toEqual([]);
    expect(corsOrigins(' https://a.co , https://b.co,')).toEqual([
      'https://a.co',
      'https://b.co',
    ]);
  });

  it('Swagger: apagado en producción salvo SWAGGER_ENABLED=true', () => {
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(
      swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
    ).toBe(true);
    expect(
      swaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }),
    ).toBe(false);
  });

  it('link de reservas: PUBLIC_BASE_URL + /reservar/ + slug', () => {
    expect(bookingUrl('mi-salon', 'https://agendity.app/')).toBe(
      'https://agendity.app/reservar/mi-salon',
    );
    expect(bookingUrl(null, 'https://agendity.app')).toBeNull();
    expect(bookingUrl('mi-salon', undefined)).toBeNull();
  });
});
