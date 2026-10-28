import { InternalServerErrorException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { timingSafeEqual } from 'crypto';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  User,
  UserSecretField,
  omitUserSecrets,
} from 'src/users/entities/user.entity';
import { Role } from 'src/roles/entities/role.entity';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  VerificationAttemptsService,
  VerificationPurpose,
} from './verification-attempts.service';

/**
 * Piezas de cuentas de usuario que comparten `AuthService` (autenticación) y
 * `EmployeesService` (gestión de empleados) desde 5.05. Sin DI: reciben el
 * repositorio que usa cada service.
 */

/**
 * Email o teléfono repetido. El texto se mantiene igual que antes: la app lo
 * compara ("Ya existe un usuario con el email"/"teléfono") hasta migrar a `code`.
 */
export function duplicateUserError(
  isEmail: boolean,
  email: string,
  phone: string,
): BusinessException {
  return isEmail
    ? new BusinessException(
        ErrorCode.DUPLICATE_EMAIL,
        `Ya existe un usuario con el email: ${email}`,
      )
    : new BusinessException(
        ErrorCode.DUPLICATE_PHONE,
        `Ya existe un usuario con el teléfono: ${phone}`,
      );
}

/** Alta de una cuenta: ni el email ni el teléfono (si viene) pueden existir. */
export async function assertEmailAndPhoneAvailable(
  users: Repository<User>,
  email: string,
  phone?: string | null,
): Promise<void> {
  // TypeORM ignora `phone: undefined` (la condición casaría con cualquier
  // usuario): el teléfono solo se compara si viene.
  const where: FindOptionsWhere<User>[] = [{ email }];
  if (phone) where.push({ phone });
  const existingUser = await users.findOne({ where });

  if (existingUser) {
    throw duplicateUserError(existingUser.email === email, email, phone);
  }
}

export async function findRole(
  roles: Repository<Role>,
  roleName: string,
): Promise<Role> {
  const role = await roles.findOne({ where: { name: roleName } });
  if (!role) {
    throw new InternalServerErrorException(
      `Role ${roleName} no está configurado en la base de datos`,
    );
  }
  return role;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Las columnas secretas de `User` tienen `select: false`. Solo los flujos que
 * comparan contraseña o códigos las piden aquí, de forma explícita.
 */
export function findUserWithSecrets(
  users: Repository<User>,
  where: FindOptionsWhere<User>,
  secrets: UserSecretField[],
  relations: string[] = [],
  { withDeleted = false }: { withDeleted?: boolean } = {},
): Promise<User | null> {
  const qb = users.createQueryBuilder('user').where(where);
  if (withDeleted) qb.withDeleted();
  for (const field of secrets) {
    qb.addSelect(`user.${field}`);
  }
  for (const relation of relations) {
    qb.leftJoinAndSelect(`user.${relation}`, relation);
  }
  return qb.getOne();
}

/** Usuario para una respuesta: sin secretos y con los roles como `{ name }`. */
export function toUserResponse(user: User) {
  const userData = omitUserSecrets(user);
  return {
    ...userData,
    roles: userData.roles.map((role) => ({ name: role.name })),
  };
}

/**
 * Comprueba un código de verificación o de reset. Cada fallo cuenta; al llegar a
 * MAX_CODE_ATTEMPTS el código se borra de la BD y hay que pedir uno nuevo.
 * `user` debe traer las columnas del código (`findUserWithSecrets`).
 */
export async function assertValidCode(
  deps: { users: Repository<User>; attempts: VerificationAttemptsService },
  purpose: VerificationPurpose,
  user: User,
  input: string,
): Promise<void> {
  const stored =
    purpose === 'reset' ? user.reset_password_code : user.verification_code;
  const expires =
    purpose === 'reset'
      ? user.reset_password_expires
      : user.verification_code_expires;

  // Código incorrecto, vencido o agotado: 400 `INVALID_VERIFICATION_CODE`
  // (2.33; antes 401, que la app confundía con una sesión vencida).
  if (!codesMatch(stored, input)) {
    const exhausted = deps.attempts.registerFailure(purpose, user.id);
    if (exhausted) {
      if (stored) await invalidateCode(deps.users, purpose, user.id);
      deps.attempts.reset(purpose, user.id);
      throw invalidCode(
        'Demasiados intentos fallidos. Solicita un código nuevo.',
      );
    }
    throw invalidCode(
      purpose === 'reset'
        ? 'Código de recuperación inválido'
        : 'Código de verificación inválido',
    );
  }

  if (!expires || new Date() > expires) {
    throw invalidCode(
      purpose === 'reset'
        ? 'El código de recuperación ha expirado'
        : 'El código de verificación ha expirado',
    );
  }
  deps.attempts.reset(purpose, user.id);
}

function codesMatch(stored: string | null, input: unknown): boolean {
  if (!stored || typeof input !== 'string') return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(input);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function invalidateCode(
  users: Repository<User>,
  purpose: VerificationPurpose,
  userId: string,
): Promise<void> {
  await users.update(
    userId,
    purpose === 'reset'
      ? { reset_password_code: null, reset_password_expires: null }
      : { verification_code: null, verification_code_expires: null },
  );
}

/** Código de verificación o de recuperación no válido (2.33). */
function invalidCode(message: string): BusinessException {
  return new BusinessException(ErrorCode.INVALID_VERIFICATION_CODE, message);
}
