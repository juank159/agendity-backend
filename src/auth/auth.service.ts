import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { User } from 'src/users/entities/user.entity';
import { Role } from 'src/roles/entities/role.entity';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import { EmailService } from 'src/email/email.service';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';
import {
  NewBusinessSettings,
  TenantSettingsService,
} from 'src/settings/tenant-settings.service';
import { LoginAuthDto, RegisterOwnerDto } from './dto';
import { assertAccountCanLogin } from './account-access';
import { JwtPayload, tenantOf } from './interfaces';
import { VerificationAttemptsService } from './verification-attempts.service';
import {
  assertEmailAndPhoneAvailable,
  assertValidCode,
  findRole,
  findUserWithSecrets,
  hashPassword,
  toUserResponse,
} from './user-accounts';

/**
 * Autenticación: alta del Owner, login (email y Google), JWT y códigos de
 * verificación y de recuperación. La gestión de empleados vive en
 * `EmployeesService` (5.05).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;
  /** Client IDs de la app (web, iOS, Android) aceptados como audiencia del ID token. */
  private readonly googleClientIds: string[];

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
    private readonly verificationAttempts: VerificationAttemptsService,
    private readonly tenantSettings: TenantSettingsService,
  ) {
    // Solo se usa para verificar ID tokens: la audiencia va en cada llamada.
    this.googleClient = new OAuth2Client();
    this.googleClientIds = parseGoogleClientIds(
      this.configService.get('GOOGLE_CLIENT_ID'),
    );
    if (this.googleClientIds.length === 0) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID vacío: el login con Google queda desactivado.',
      );
    }
  }

  /** `user` debe traer `roles` y, si es empleado, `owner`. */
  private generateToken(user: User): string {
    const tenantId = tenantOf(user);
    const payload: JwtPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles.map((role) => role.name),
      tenantId,
      ownerId: tenantId,
      tenant_id: tenantId,
    };
    return this.jwtService.sign(payload);
  }

  /** Código de 6 dígitos con aleatoriedad criptográfica. */
  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private codeExpiry(): Date {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 10);
    return expires;
  }

  private get codeDeps() {
    return { users: this.userRepository, attempts: this.verificationAttempts };
  }

  /**
   * ÚNICA alta de un negocio (Owner), por email o por Google (2.19): el tenant
   * es su propio id (2.01) y nace con su fila de suscripción trial, las dos en
   * la misma transacción (sin Owner sin suscripción ni suscripción huérfana).
   * `data` trae ya la contraseña con hash; el rol siempre es Owner (los
   * `roles` que traiga el DTO se ignoran, como antes).
   * 6.01: en la misma transacción, su configuración (`business_settings`) con
   * la zona que manda la app (la del dispositivo) o, si no llega o no es
   * válida, `BUSINESS_TIMEZONE`; 8.00: y el nombre del negocio, si llega.
   */
  private async createOwnerAccount(
    data: Omit<Partial<User>, 'roles'>,
    business: NewBusinessSettings = {},
  ): Promise<User> {
    const ownerRole = await findRole(this.roleRepository, 'Owner');
    const id = uuid();
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const owner = await users.save(
        users.create({ ...data, id, tenant_id: id, roles: [ownerRole] }),
      );
      await this.subscriptionsService.createTrialSubscription(id, manager);
      await this.tenantSettings.createForTenant(id, business, manager);
      return owner;
    });
  }

  async createOwner(createAuthDto: RegisterOwnerDto) {
    await assertEmailAndPhoneAvailable(
      this.userRepository,
      createAuthDto.email,
      createAuthDto.phone,
    );

    // `timezone` y `business_name` van a la configuración del negocio, no a `users`.
    const { password, timezone, business_name, ...userData } = createAuthDto;
    const newUser = await this.createOwnerAccount(
      { ...userData, password: await hashPassword(password) },
      { timezone, name: business_name },
    );

    return {
      user: toUserResponse(newUser),
      token: this.generateToken(newUser),
    };
  }

  async login(loginAuthDto: LoginAuthDto) {
    const { email, password } = loginAuthDto;
    // Con borrados: así una cuenta dada de baja recibe su motivo (2.12).
    const user = await findUserWithSecrets(
      this.userRepository,
      { email },
      ['password'],
      ['roles', 'owner'],
      { withDeleted: true },
    );

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    // Solo tras la contraseña correcta: no revela el estado de cuentas ajenas.
    assertAccountCanLogin(user);

    return {
      user: toUserResponse(user),
      token: this.generateToken(user),
    };
  }

  /**
   * Usuario de la sesión (2.35, `GET /auth/me`): solo los campos que necesita
   * la app, sin secretos (parte de `toUserResponse`). `tenantId` = id del Owner
   * (Owner: el suyo; Employee: el de su owner). El acceso ya lo validó
   * `JwtStrategy` en esta misma petición; si la fila desapareció, 404.
   * 6.01: incluye la zona horaria del negocio (`timezone`, cacheada) para que
   * la app la tenga en la sesión sin otra petición.
   */
  async me(userId: string): Promise<SessionUser> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles', 'owner'],
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    const data = toUserResponse(user);
    const tenantId = tenantOf(user);
    const business = await this.tenantSettings.getCachedSettings(tenantId);
    return {
      id: data.id,
      name: data.name,
      lastname: data.lastname,
      email: data.email,
      phone: data.phone,
      image: data.image ?? null,
      roles: data.roles,
      tenantId,
      timezone: business.timezone,
      business_name: business.name,
      isActive: data.isActive,
      is_email_verified: data.is_email_verified,
    };
  }

  /**
   * Verifica el ID token de Google: firma, expiración y que la audiencia sea uno
   * de nuestros client IDs. Sin client IDs configurados no se verifica nunca
   * (sin audiencia valdría un token emitido para cualquier app de Google).
   */
  private async verifyGoogleToken(token: string): Promise<TokenPayload> {
    if (this.googleClientIds.length === 0) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'El inicio de sesión con Google no está disponible',
      );
    }
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: this.googleClientIds,
      });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(`Token de Google rechazado: ${error.message}`);
    }
    // Sin email verificado por Google no se puede asociar a una cuenta por email.
    if (!payload?.email || payload.email_verified !== true) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Token de Google inválido',
      );
    }
    return payload;
  }

  /** `timezone` (opcional, 6.01): zona del dispositivo; solo se usa en un alta nueva. */
  async googleLogin(token: string, timezone?: unknown) {
    const payload = await this.verifyGoogleToken(token);
    try {
      const { email, name } = payload;

      // Con borrados: una cuenta dada de baja no se "recrea" como Owner nueva.
      let user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'owner'],
        withDeleted: true,
      });

      if (user) {
        assertAccountCanLogin(user);
      } else {
        // Si no existe: alta de un negocio nuevo, igual que el registro por
        // email (Owner + trial, 2.19). Nombre y apellido del nombre completo.
        const [firstName, ...lastNameParts] = (name ?? '').split(' ');
        const lastName = lastNameParts.join(' ');

        user = await this.createOwnerAccount(
          {
            email,
            name: firstName || '',
            lastname: lastName || '',
            phone: null, // Sin teléfono: único pero opcional (2.10)
            password: await hashPassword(uuid()), // Contraseña aleatoria
            is_google_account: true,
            is_email_verified: true, // Los emails de Google ya están verificados
          },
          { timezone },
        );
      }

      return {
        user: toUserResponse(user),
        token: this.generateToken(user),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // El detalle (p. ej. un error de BD) va al log, nunca a la respuesta.
      this.logger.error(
        `Error en el login con Google: ${error?.message}`,
        error?.stack,
      );
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        'Error en autenticación con Google',
      );
    }
  }

  /**
   * Envía un código de verificación a una cuenta que YA existe (2.19). Antes,
   * con `isNewUser: true` y un email desconocido, creaba un registro temporal
   * ('Pendiente', sin rol) que después bloqueaba `register/owner` con ese email
   * (`DUPLICATE_EMAIL`) y dejaba a cualquiera reservar emails ajenos desde una
   * ruta pública. La app nunca lo necesitó: registra primero y pide el código
   * después. Email desconocido → 404 (como ya pasaba con `isNewUser: false`).
   */
  async generateVerificationCode(email: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const code = this.generateCode();
      user.verification_code = code;
      user.verification_code_expires = this.codeExpiry();
      await this.userRepository.save(user);
      this.verificationAttempts.reset('verify', user.id);

      await this.deliverCode(() =>
        this.emailService.sendVerificationCode(email, code),
      );

      return { message: 'Código de verificación enviado' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error inesperado generando el código: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Error inesperado en generación de código',
      );
    }
  }

  /**
   * Envía un correo con un código (verificación o recuperación). Si el
   * servidor de correo falla, 503 `EMAIL_DELIVERY_FAILED` con un texto claro
   * (7.03; antes 500 genérico): no es culpa de la petición (no es 4xx) y es
   * temporal, así que la app puede ofrecer reintentar (pedir otro código
   * reinicia el código y sus intentos). El código guardado no se usa: nadie
   * lo recibió.
   */
  private async deliverCode(send: () => Promise<boolean>): Promise<void> {
    let sent = false;
    try {
      sent = await send();
    } catch (error) {
      this.logger.error(`Error enviando el correo: ${error?.message}`);
    }
    if (!sent) {
      throw new BusinessException(
        ErrorCode.EMAIL_DELIVERY_FAILED,
        'No pudimos enviar el correo con el código. Intenta de nuevo en unos minutos.',
      );
    }
  }

  async verifyEmail(email: string, code: string) {
    const user = await findUserWithSecrets(this.userRepository, { email }, [
      'verification_code',
      'verification_code_expires',
    ]);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await assertValidCode(this.codeDeps, 'verify', user, code);

    user.is_email_verified = true;
    user.verification_code = null;
    user.verification_code_expires = null;
    await this.userRepository.save(user);

    return {
      message: 'Email verificado correctamente',
      is_verified: true,
    };
  }

  async generatePasswordResetCode(email: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const code = this.generateCode();
      user.reset_password_code = code;
      user.reset_password_expires = this.codeExpiry();
      await this.userRepository.save(user);
      this.verificationAttempts.reset('reset', user.id);

      await this.deliverCode(() =>
        this.emailService.sendPasswordResetCode(email, code),
      );

      return { message: 'Código de recuperación enviado' };
    } catch (error) {
      this.logger.error(
        `Error generando código de recuperación: ${error.message}`,
      );
      throw error;
    }
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await findUserWithSecrets(this.userRepository, { email }, [
      'reset_password_code',
      'reset_password_expires',
    ]);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await assertValidCode(this.codeDeps, 'reset', user, code);

    user.password = await hashPassword(newPassword);
    user.reset_password_code = null;
    user.reset_password_expires = null;
    await this.userRepository.save(user);

    return {
      message: 'Contraseña actualizada correctamente',
    };
  }
}

/** Respuesta de `GET /auth/me` (2.35). */
export interface SessionUser {
  id: string;
  name: string;
  lastname: string;
  email: string;
  phone: string | null;
  image: string | null;
  roles: { name: string }[];
  tenantId: string;
  /** Zona IANA del negocio (6.01). */
  timezone: string;
  /** Nombre del negocio (8.00); `null` si no lo ha puesto. */
  business_name: string | null;
  isActive: boolean;
  is_email_verified: boolean;
}

/**
 * `GOOGLE_CLIENT_ID` admite varios client IDs separados por comas (web, iOS,
 * Android). Recorta espacios y descarta los vacíos.
 */
export function parseGoogleClientIds(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}
