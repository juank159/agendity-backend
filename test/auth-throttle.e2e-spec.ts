/**
 * Tarea 1.04: throttle por IP en /auth/* y límite de intentos por código.
 *
 * Sin modificar datos reales:
 * - El throttle se prueba con emails que no existen (login → 401, verify → 404):
 *   son lecturas y la petición 429 la corta el guard antes del handler.
 * - El límite por código se prueba llamando a AuthService con un usuario falso
 *   (se intercepta `findUserWithSecrets`) y con `Repository.update/save` simulados.
 */
import { INestApplication } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { MAX_CODE_ATTEMPTS } from '../src/auth/verification-attempts.service';
import { AUTH_RATE_LIMITS } from '../src/common/decorators/rate-limit.decorator';
import { User } from '../src/users/entities/user.entity';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';

const FAKE_ID = '22222222-2222-4222-8222-222222222222';

describe('Throttle de /auth y límite por código (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let authService: AuthService;

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    authService = app.get(AuthService);
  }, E2E_BOOT_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await close?.();
  });

  describe('throttle por IP', () => {
    it(`POST /auth/login responde 429 después de ${AUTH_RATE_LIMITS.login} intentos por minuto`, async () => {
      const statuses: number[] = [];
      let lastBody: Record<string, unknown> = {};
      for (let i = 0; i <= AUTH_RATE_LIMITS.login; i++) {
        // Se crea y se envía cada petición en orden (ver user-access.e2e-spec).
        const res = await http
          .post('/api/auth/login')
          .send({ email: 'nadie@e2e.example', password: 'x' });
        statuses.push(res.status);
        lastBody = res.body;
      }
      expect(statuses.slice(0, AUTH_RATE_LIMITS.login)).toEqual(
        Array(AUTH_RATE_LIMITS.login).fill(401),
      );
      expect(statuses[AUTH_RATE_LIMITS.login]).toBe(429);
      expect(lastBody.code).toBe('TOO_MANY_REQUESTS');
    });

    it(`POST /auth/verify/email responde 429 después de ${AUTH_RATE_LIMITS.verifyCode} intentos por minuto`, async () => {
      const statuses: number[] = [];
      for (let i = 0; i <= AUTH_RATE_LIMITS.verifyCode; i++) {
        const res = await http
          .post('/api/auth/verify/email')
          .send({ email: 'nadie@e2e.example', code: '000000' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, AUTH_RATE_LIMITS.verifyCode)).toEqual(
        Array(AUTH_RATE_LIMITS.verifyCode).fill(404),
      );
      expect(statuses[AUTH_RATE_LIMITS.verifyCode]).toBe(429);
    });

    it('las rutas sin @RateLimit no tienen throttle', async () => {
      const statuses = new Set<number>();
      for (let i = 0; i < 30; i++) {
        const res = await http.get('/api/services');
        statuses.add(res.status);
      }
      expect([...statuses]).toEqual([401]);
    });
  });

  describe('límite de intentos por código', () => {
    const fakeUser = (overrides: Partial<User> = {}): User =>
      Object.assign(new User(), {
        id: FAKE_ID,
        email: 'fake@e2e.example',
        verification_code: '123456',
        verification_code_expires: new Date(Date.now() + 5 * 60_000),
        reset_password_code: '654321',
        reset_password_expires: new Date(Date.now() + 5 * 60_000),
        ...overrides,
      });

    const mockDb = (user: User) => {
      jest
        .spyOn(authService as any, 'findUserWithSecrets')
        .mockImplementation(async () => user);
      const update = jest
        .spyOn(Repository.prototype, 'update')
        .mockImplementation(async () => ({
          raw: [],
          affected: 1,
          generatedMaps: [],
        }));
      const save = jest
        .spyOn(Repository.prototype, 'save')
        .mockImplementation(async (entity: any) => entity);
      return { update, save };
    };

    const errorOf = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        return e;
      }
    };

    it(`verifyEmail: al fallo nº ${MAX_CODE_ATTEMPTS} invalida el código en la BD`, async () => {
      const { update } = mockDb(fakeUser());
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
        const err: any = await errorOf(authService.verifyEmail('x', '000000'));
        // 2.33: 400 INVALID_VERIFICATION_CODE (antes 401, que la app tomaba
        // por una sesión vencida).
        expect(err.getStatus()).toBe(400);
        expect(err.getResponse()).toEqual({
          statusCode: 400,
          code: 'INVALID_VERIFICATION_CODE',
          message: 'Código de verificación inválido',
        });
      }
      expect(update).not.toHaveBeenCalled();

      const last: any = await errorOf(authService.verifyEmail('x', '000000'));
      expect((last as Error).message).toMatch(/Demasiados intentos/);
      expect(last.getResponse()).toMatchObject({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
      });
      expect(update).toHaveBeenCalledWith(FAKE_ID, {
        verification_code: null,
        verification_code_expires: null,
      });
    });

    it('resetPassword: mismo límite y borra el código de reset', async () => {
      const { update, save } = mockDb(fakeUser());
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
        await errorOf(authService.resetPassword('x', '000000', 'Nueva#Clave1'));
      }
      const last: any = await errorOf(
        authService.resetPassword('x', '000000', 'Nueva#Clave1'),
      );
      expect((last as Error).message).toMatch(/Demasiados intentos/);
      expect(last.getResponse()).toMatchObject({
        code: 'INVALID_VERIFICATION_CODE',
      });
      expect(update).toHaveBeenCalledWith(FAKE_ID, {
        reset_password_code: null,
        reset_password_expires: null,
      });
      expect(save).not.toHaveBeenCalled();
    });

    it('un acierto reinicia el contador', async () => {
      const { save } = mockDb(fakeUser());
      for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
        await errorOf(authService.verifyEmail('x', '000000'));
      }
      await expect(authService.verifyEmail('x', '123456')).resolves.toEqual(
        expect.objectContaining({ is_verified: true }),
      );
      expect(save).toHaveBeenCalledTimes(1);

      // El usuario falso conserva el código: se puede volver a fallar desde cero.
      jest.restoreAllMocks();
      const second = mockDb(fakeUser());
      const err = await errorOf(authService.verifyEmail('x', '000000'));
      expect((err as Error).message).toBe('Código de verificación inválido');
      expect(second.update).not.toHaveBeenCalled();
    });

    it('un código vacío o ya invalidado nunca es válido', async () => {
      mockDb(fakeUser({ verification_code: null }));
      const err: any = await errorOf(authService.verifyEmail('x', ''));
      expect(err.getResponse()).toMatchObject({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
      });
    });

    it('código vencido: 400 INVALID_VERIFICATION_CODE "ha expirado" (2.33)', async () => {
      mockDb(fakeUser({ verification_code_expires: new Date(Date.now() - 1) }));
      const err: any = await errorOf(authService.verifyEmail('x', '123456'));
      expect(err.getResponse()).toEqual({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
        message: 'El código de verificación ha expirado',
      });
    });

    it('los códigos son de 6 dígitos (crypto.randomInt)', () => {
      const generate = () => (authService as any).generateCode() as string;
      for (let i = 0; i < 500; i++) {
        expect(generate()).toMatch(/^[1-9]\d{5}$/);
      }
    });
  });
});
