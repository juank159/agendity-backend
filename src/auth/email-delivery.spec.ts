import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AuthService } from './auth.service';

/**
 * 7.03 (e): si el SMTP falla, `verify/request-code` y `forgot-password`
 * responden 503 `EMAIL_DELIVERY_FAILED` con un texto claro (antes, 500).
 */
function build(send: jest.Mock) {
  const user = { id: 'u1', email: 'ana@test.co' };
  const userRepository = {
    findOne: jest.fn().mockResolvedValue(user),
    save: jest.fn(async (u) => u),
  };
  const email = { sendVerificationCode: send, sendPasswordResetCode: send };
  const service = new AuthService(
    userRepository as any,
    {} as any,
    {} as any,
    { get: () => undefined } as unknown as ConfigService,
    email as any,
    {} as any,
    {} as any,
    { reset: jest.fn() } as any,
    {} as any,
  );
  return { service, userRepository };
}

describe('Envío de códigos por correo (7.03)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it.each([
    ['devuelve false', jest.fn().mockResolvedValue(false)],
    ['lanza', jest.fn().mockRejectedValue(new Error('SMTP caído'))],
  ])(
    'el SMTP %s: 503 EMAIL_DELIVERY_FAILED (el código sí se guardó)',
    async (_case, send) => {
      const { service, userRepository } = build(send);
      for (const call of [
        () => service.generateVerificationCode('ana@test.co'),
        () => service.generatePasswordResetCode('ana@test.co'),
      ]) {
        const error = await call().catch((e) => e);
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({
          code: ErrorCode.EMAIL_DELIVERY_FAILED,
          message: expect.stringContaining('No pudimos enviar el correo'),
        });
      }
      expect(userRepository.save).toHaveBeenCalledTimes(2);
    },
  );

  it('correo enviado: 201 con el mensaje de siempre', async () => {
    const { service } = build(jest.fn().mockResolvedValue(true));
    await expect(
      service.generateVerificationCode('ana@test.co'),
    ).resolves.toEqual({ message: 'Código de verificación enviado' });
  });
});
