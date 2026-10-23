import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_BLOCK_MESSAGES,
  accountBlock,
  assertAccountCanLogin,
} from './account-access';
import { AuthService } from './auth.service';

const OWNER = { id: 'o1', isActive: true, deletedAt: null };
const employee = (extra: Record<string, unknown> = {}) => ({
  id: 'e1',
  email: 'luis@x.co',
  name: 'Luis',
  isActive: true,
  is_email_verified: true,
  deletedAt: null,
  roles: [{ name: 'Employee' }],
  owner: OWNER,
  password: '$2b$hash',
  ...extra,
});
const owner = (extra: Record<string, unknown> = {}) => ({
  id: 'o1',
  email: 'ana@x.co',
  name: 'Ana',
  isActive: true,
  is_email_verified: false,
  deletedAt: null,
  roles: [{ name: 'Owner' }],
  owner: null,
  password: '$2b$hash',
  ...extra,
});

describe('accountBlock (2.12)', () => {
  it('cuentas con acceso', () => {
    expect(accountBlock(employee())).toBeNull();
    // Regla vigente: el Owner entra aunque no haya verificado su email.
    expect(accountBlock(owner())).toBeNull();
    expect(
      accountBlock({ roles: [{ name: 'Admin' }], owner: null }),
    ).toBeNull();
  });

  it('motivos, en orden: borrada, sin negocio, sin verificar, desactivada', () => {
    expect(
      accountBlock(employee({ deletedAt: new Date(), isActive: false })),
    ).toBe('DELETED');
    expect(accountBlock(employee({ owner: null, isActive: false }))).toBe(
      'NO_BUSINESS',
    );
    expect(
      accountBlock(employee({ owner: { ...OWNER, deletedAt: new Date() } })),
    ).toBe('NO_BUSINESS');
    expect(
      accountBlock(employee({ owner: { ...OWNER, isActive: false } })),
    ).toBe('NO_BUSINESS');
    expect(
      accountBlock(employee({ isActive: false, is_email_verified: false })),
    ).toBe('NOT_VERIFIED');
    expect(accountBlock(employee({ isActive: false }))).toBe('DEACTIVATED');
    expect(accountBlock(owner({ isActive: false }))).toBe('NOT_VERIFIED');
  });

  it('un Owner sin owner no es huérfano', () => {
    expect(accountBlock(owner({ owner: null }))).toBeNull();
  });

  it('los textos no activan los marcados de campo de login_controller.dart', () => {
    for (const text of Object.values(ACCOUNT_BLOCK_MESSAGES)) {
      expect(text.toLowerCase()).not.toMatch(
        /credenciales|email|correo|password|contraseña/,
      );
    }
  });

  it('assertAccountCanLogin: 403 ACCOUNT_INACTIVE con el motivo', () => {
    const error = (() => {
      try {
        assertAccountCanLogin(employee({ isActive: false }));
      } catch (e) {
        return e;
      }
    })();
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({
      code: 'ACCOUNT_INACTIVE',
      message: ACCOUNT_BLOCK_MESSAGES.DEACTIVATED,
    });
  });
});

describe('Login con cuentas sin acceso (2.12)', () => {
  function build(user: unknown) {
    const qb: any = {
      where: jest.fn(() => qb),
      withDeleted: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      leftJoinAndSelect: jest.fn(() => qb),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const userRepository = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(),
    };
    const jwtService = { sign: jest.fn(() => 'jwt') };
    const config = {
      get: (k: string) => (k === 'GOOGLE_CLIENT_ID' ? 'web-id' : undefined),
    } as unknown as ConfigService;
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
    return { service, qb, userRepository, jwtService };
  }

  afterEach(() => jest.restoreAllMocks());

  it('email: contraseña correcta + cuenta desactivada → 403 ACCOUNT_INACTIVE, sin token; busca con borrados', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const { service, qb, jwtService } = build(employee({ isActive: false }));
    const error = await service
      .login({ email: 'luis@x.co', password: 'Clave123!' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    expect(qb.withDeleted).toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('email: contraseña incorrecta en una cuenta borrada → 401 "Credenciales inválidas" (no revela el estado)', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
    const { service } = build(employee({ deletedAt: new Date() }));
    const error = await service
      .login({ email: 'luis@x.co', password: 'x' })
      .catch((e) => e);
    expect(error.getStatus()).toBe(401);
  });

  it('email: empleado huérfano y empleado borrado → 403 con su motivo', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    for (const [row, block] of [
      [employee({ owner: null }), 'NO_BUSINESS'],
      [employee({ deletedAt: new Date() }), 'DELETED'],
      [employee({ isActive: false, is_email_verified: false }), 'NOT_VERIFIED'],
    ] as const) {
      const { service } = build(row);
      const error = await service
        .login({ email: 'luis@x.co', password: 'Clave123!' })
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        code: 'ACCOUNT_INACTIVE',
        message: ACCOUNT_BLOCK_MESSAGES[block],
      });
    }
  });

  it('email: Owner sin email verificado entra (regla vigente)', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
    const { service } = build(owner());
    const result = await service.login({
      email: 'ana@x.co',
      password: 'Clave123!',
    });
    expect(result.token).toBe('jwt');
  });

  it('Google: cuenta existente desactivada o borrada → 403, sin crear otra cuenta', async () => {
    jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        email: 'luis@x.co',
        email_verified: true,
        name: 'Luis',
      }),
    } as never);
    for (const row of [
      employee({ isActive: false }),
      employee({ deletedAt: new Date() }),
    ]) {
      const { service, userRepository } = build(row);
      const error = await service.googleLogin('t').catch((e) => e);
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
      expect(userRepository.save).not.toHaveBeenCalled();
    }
  });
});
