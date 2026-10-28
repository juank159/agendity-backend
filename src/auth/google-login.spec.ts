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

describe('AuthService.googleLogin: usuarios nuevos sin teléfono (2.10)', () => {
  beforeAll(() => Logger.overrideLogger(false));
  afterEach(() => jest.restoreAllMocks());

  function buildNew() {
    const config = {
      get: (key: string) => (key === 'GOOGLE_CLIENT_ID' ? WEB : undefined),
    } as unknown as ConfigService;
    const saved: any[] = [];
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (user: any) => {
        saved.push({ ...user });
        return user;
      }),
    };
    const roleRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'r1', name: 'Owner' }),
    };
    const jwtService = {
      sign: jest.fn((payload: any) => `agendity-jwt-for-${payload.id}`),
    };
    // Alta de Owner (2.19): usuario y trial en la misma transacción.
    const manager = { getRepository: jest.fn(() => userRepository) };
    const dataSource = {
      transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
        work(manager),
      ),
    };
    const subscriptions = {
      createTrialSubscription: jest.fn(async (tenantId: string) => ({
        tenant_id: tenantId,
      })),
    };
    const service = new AuthService(
      userRepository as any,
      roleRepository as any,
      jwtService as any,
      config,
      {} as any,
      subscriptions as any,
      dataSource as any,
      {} as any,
      { createForTenant: jest.fn() } as any,
    );
    return {
      service,
      userRepository,
      jwtService,
      saved,
      subscriptions,
      manager,
      dataSource,
    };
  }

  it('un alta por Google crea la suscripción trial del negocio, en la transacción del usuario (2.19)', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockResolvedValue(
        ticket({ email: 'nuevo@gmail.com', email_verified: true, name: 'N' }),
      );
    const { service, saved, subscriptions, manager, dataSource } = buildNew();
    await service.googleLogin('t');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(subscriptions.createTrialSubscription).toHaveBeenCalledWith(
      saved[0].id,
      manager,
    );
  });

  it('el registro por email usa la MISMA alta (Owner + trial en una transacción)', async () => {
    const { service, saved, subscriptions, manager, userRepository } =
      buildNew();
    userRepository.findOne.mockResolvedValue(null);
    const result = await service.createOwner({
      name: 'Ana',
      lastname: 'Pérez',
      email: 'ana@example.com',
      phone: '3001234567',
      password: 'Secreta1!',
      roles: ['Admin'],
    } as any);
    expect(subscriptions.createTrialSubscription).toHaveBeenCalledWith(
      saved[0].id,
      manager,
    );
    expect(saved[0].tenant_id).toBe(saved[0].id);
    expect(saved[0].roles).toEqual([{ id: 'r1', name: 'Owner' }]); // ignora los del DTO
    expect(saved[0].password).toMatch(/^\$2/);
    expect(result.user.roles).toEqual([{ name: 'Owner' }]);
  });

  it('si falla el trial, el error sale de la transacción (no queda Owner sin suscripción)', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockResolvedValue(
        ticket({ email: 'otro@gmail.com', email_verified: true, name: 'N' }),
      );
    const { service, subscriptions, dataSource } = buildNew();
    subscriptions.createTrialSubscription.mockRejectedValueOnce(
      new Error('fallo de BD'),
    );
    await expect(service.googleLogin('t')).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
    await expect(dataSource.transaction.mock.results[0].value).rejects.toThrow(
      'fallo de BD',
    );
  });

  it('dos altas seguidas guardan phone = null (nunca "") y responden el JWT propio', async () => {
    const verify = jest.spyOn(OAuth2Client.prototype as any, 'verifyIdToken');
    const { service, saved, jwtService } = buildNew();

    const results = [];
    for (const email of ['uno@gmail.com', 'dos@gmail.com']) {
      verify.mockResolvedValueOnce(
        ticket({ email, email_verified: true, name: 'Ana María Pérez' }),
      );
      results.push(await service.googleLogin('google-id-token'));
    }

    expect(saved).toHaveLength(2);
    for (const user of saved) {
      expect(user.phone).toBeNull();
      expect(user.is_google_account).toBe(true);
      expect(user.is_email_verified).toBe(true);
      expect(user.tenant_id).toBe(user.id);
    }
    expect(saved[0].name).toBe('Ana');
    expect(saved[0].lastname).toBe('María Pérez');
    // El token es el de Agendity (firmado por el backend), no el de Google.
    for (const [i, result] of results.entries()) {
      expect(result.token).toBe(`agendity-jwt-for-${saved[i].id}`);
      expect(result.token).not.toBe('google-id-token');
      expect(result.user).toMatchObject({
        email: saved[i].email,
        phone: null,
        roles: [{ name: 'Owner' }],
      });
      expect(result.user).not.toHaveProperty('password');
    }
    expect(jwtService.sign.mock.calls[0][0]).toMatchObject({
      roles: ['Owner'],
      tenantId: saved[0].id,
      tenant_id: saved[0].id,
    });
  });

  it('un error inesperado responde 401 genérico sin el detalle interno', async () => {
    jest
      .spyOn(OAuth2Client.prototype as any, 'verifyIdToken')
      .mockResolvedValue(
        ticket({ email: 'tres@gmail.com', email_verified: true, name: 'X' }),
      );
    const { service, userRepository } = buildNew();
    userRepository.save.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "UQ_secreto"'),
    );

    const error = await service.googleLogin('t').catch((e) => e);
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Error en autenticación con Google',
      }),
    );
    expect(JSON.stringify(error.getResponse())).not.toContain('UQ_secreto');
  });
});

describe('AuthService.generateVerificationCode: sin registros temporales (2.19)', () => {
  it('email desconocido → 404 y no crea ninguna fila (antes: usuario "Pendiente")', async () => {
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
    };
    const service = new AuthService(
      userRepository as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const error = await service
      .generateVerificationCode('nadie@example.com')
      .catch((e) => e);
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(userRepository.create).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
  });
});
