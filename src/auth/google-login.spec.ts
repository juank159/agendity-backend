import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AuthService, parseGoogleClientIds } from './auth.service';

const WEB = 'web-id.apps.googleusercontent.com';
const IOS = 'ios-id.apps.googleusercontent.com';
const ANDROID = 'android-id.apps.googleusercontent.com';

const existingUser = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@example.com',
  roles: [{ name: 'Owner' }],
  tenant_id: 't1',
};

function build(googleClientId: string | undefined) {
  const config = {
    get: (key: string) =>
      key === 'GOOGLE_CLIENT_ID' ? googleClientId : undefined,
  } as unknown as ConfigService;
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(existingUser),
  };
  const jwtService = { sign: jest.fn().mockReturnValue('jwt') };
  const service = new AuthService(
    userRepository as any,
    {} as any,
    jwtService as any,
    config,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, userRepository };
}

function ticket(payload: Record<string, unknown>) {
  return { getPayload: () => payload } as any;
}

async function expectUnauthorized(promise: Promise<unknown>, message: string) {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(BusinessException);
  expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  expect(error.getResponse()).toEqual(
    expect.objectContaining({ code: ErrorCode.UNAUTHORIZED, message }),
  );
}

describe('parseGoogleClientIds', () => {
  it('separa por comas, recorta espacios y descarta vacíos', () => {
    expect(parseGoogleClientIds(` ${WEB} ,${IOS},, ${ANDROID} , `)).toEqual([
      WEB,
      IOS,
      ANDROID,
    ]);
  });

  it.each([[''], ['  '], [' , ,'], [undefined], [null]])(
    'sin IDs (%p) da lista vacía',
    (raw) => {
      expect(parseGoogleClientIds(raw as string)).toEqual([]);
    },
  );
});

describe('AuthService.googleLogin: audiencia obligatoria', () => {
  let verifyIdToken: jest.SpyInstance;

  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => {
    verifyIdToken = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken');
  });
  afterEach(() => jest.restoreAllMocks());

  it('pasa la lista completa (sin espacios) como audience', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ email: existingUser.email, email_verified: true, name: 'Ana' }),
    );
    const { service } = build(`${WEB}, ${IOS} ,${ANDROID}`);

    const result = await service.googleLogin('id-token');

    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: [WEB, IOS, ANDROID],
    });
    expect(result.token).toBe('jwt');
  });

  it.each([
    ['vacía', ''],
    ['solo comas y espacios', ' , '],
    ['ausente', undefined],
  ])(
    'con la variable %s responde UNAUTHORIZED y nunca verifica',
    async (_label, raw) => {
      const { service, userRepository } = build(raw);

      await expectUnauthorized(
        service.googleLogin('id-token'),
        'El inicio de sesión con Google no está disponible',
      );
      expect(verifyIdToken).not.toHaveBeenCalled();
      expect(userRepository.findOne).not.toHaveBeenCalled();
    },
  );

  it('rechaza un token con audiencia no permitida', async () => {
    verifyIdToken.mockRejectedValue(
      new Error('Wrong recipient, payload audience != requiredAudience'),
    );
    const { service, userRepository } = build(WEB);

    await expectUnauthorized(
      service.googleLogin('token-de-otra-app'),
      'Token de Google inválido',
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });

  it('rechaza un token sin email verificado por Google', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ email: existingUser.email, email_verified: false }),
    );
    const { service, userRepository } = build(WEB);

    await expectUnauthorized(
      service.googleLogin('id-token'),
      'Token de Google inválido',
    );
    expect(userRepository.findOne).not.toHaveBeenCalled();
  });
});
