import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces';
import { Role } from 'src/roles/entities/role.entity';
import { v4 as uuid } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/email/email.service';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => SubscriptionsService)) // Evita dependencia circular
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    // Inicializar cliente de Google con tu Client ID
    this.googleClient = new OAuth2Client(
      this.configService.get('GOOGLE_CLIENT_ID'),
    );
  }

  private async validateUserExists(email: string, phone: string) {
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { phone }],
    });

    if (existingUser) {
      const duplicatedField =
        existingUser.email === email ? 'email' : 'teléfono';
      const duplicatedValue = duplicatedField === 'email' ? email : phone;
      throw new ConflictException(
        `Ya existe un usuario con el ${duplicatedField}: ${duplicatedValue}`,
      );
    }
  }

  private async getRole(roleName: string): Promise<Role> {
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });

    if (!role) {
      throw new InternalServerErrorException(
        `Role ${roleName} no está configurado en la base de datos`,
      );
    }

    return role;
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private generateToken(user: User): string {
    const payload: JwtPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      roles: user.roles.map((role) => role.name),
      tenant_id: user.tenant_id,
      owner_id: user.owner?.id,
    };

    return this.getJwtToken(payload);
  }

  private transformUserResponse(user: User) {
    const { password, ...userData } = user;
    return {
      ...userData,
      roles: userData.roles.map((role) => ({ name: role.name })),
    };
  }

  async createOwner(createAuthDto: CreateAuthDto) {
    try {
      await this.validateUserExists(createAuthDto.email, createAuthDto.phone);

      const ownerRole = await this.getRole('Owner');
      const { password, ...userData } = createAuthDto;

      const newUser = this.userRepository.create({
        ...userData,
        password: await this.hashPassword(password),
        roles: [ownerRole],
        tenant_id: uuid(), // Generar nuevo tenant_id para el owner
      });

      await this.userRepository.save(newUser);

      // Crear suscripción de prueba para el nuevo tenant
      await this.subscriptionsService.createTrialSubscription(
        newUser.tenant_id,
      );

      return {
        user: this.transformUserResponse(newUser),
        token: this.generateToken(newUser),
      };
    } catch (error) {
      throw error;
    }
  }

  async createEmployee(createEmployeeDto: CreateEmployeeDto, owner: User) {
    try {
      await this.validateUserExists(
        createEmployeeDto.email,
        createEmployeeDto.phone,
      );

      const employeeRole = await this.getRole('Employee');
      const { password, ...userData } = createEmployeeDto;

      const newEmployee = this.userRepository.create({
        ...userData,
        password: await this.hashPassword(password),
        roles: [employeeRole],
        owner: owner,
        tenant_id: owner.tenant_id, // Usar el tenant_id del owner
      });

      await this.userRepository.save(newEmployee);

      return {
        user: this.transformUserResponse(newEmployee),
        token: this.generateToken(newEmployee),
      };
    } catch (error) {
      throw error;
    }
  }

  async login(loginAuthDto: LoginAuthDto) {
    try {
      const { email, password } = loginAuthDto;
      const user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'owner'],
      });

      if (!user || !(await bcrypt.compare(password, user.password))) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      return {
        user: this.transformUserResponse(user),
        token: this.generateToken(user),
      };
    } catch (error) {
      throw error;
    }
  }

  async googleLogin(token: string) {
    try {
      // Verificar el token con Google
      const ticket = await this.googleClient.verifyIdToken({
        idToken: token,
        audience: this.configService.get('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();

      if (!payload) {
        throw new UnauthorizedException('Token inválido');
      }

      const { email, name, picture } = payload;

      // Buscar si el usuario ya existe
      let user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'owner'],
      });

      if (!user) {
        // Si no existe, crear nuevo usuario
        const ownerRole = await this.getRole('Owner');

        // Extraer nombre y apellido del nombre completo
        const [firstName, ...lastNameParts] = name.split(' ');
        const lastName = lastNameParts.join(' ');

        user = this.userRepository.create({
          email,
          name: firstName || '',
          lastname: lastName || '',
          phone: '', // Este campo podría ser solicitado después
          password: await this.hashPassword(uuid()), // Generar contraseña aleatoria
          is_google_account: true,
          is_email_verified: true, // Los emails de Google ya están verificados
          roles: [ownerRole],
          tenant_id: uuid(),
        });

        await this.userRepository.save(user);
      }

      // Generar token y retornar usuario
      return {
        user: this.transformUserResponse(user),
        token: this.generateToken(user),
      };
    } catch (error) {
      throw new UnauthorizedException(
        'Error en autenticación con Google: ' + error.message,
      );
    }
  }

  async generateVerificationCode(email: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Generar código de 6 dígitos
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Establecer expiración (10 minutos)
      const expires = new Date();
      expires.setMinutes(expires.getMinutes() + 10);

      // Guardar en el usuario
      user.verification_code = code;
      user.verification_code_expires = expires;
      await this.userRepository.save(user);

      // Enviar email
      const emailSent = await this.emailService.sendVerificationCode(
        email,
        code,
      );

      if (!emailSent) {
        throw new InternalServerErrorException(
          'Error al enviar el código de verificación',
        );
      }

      return { message: 'Código de verificación enviado' };
    } catch (error) {
      throw error;
    }
  }

  async verifyEmail(email: string, code: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        console.log(`Usuario no encontrado para email: ${email}`);
        throw new NotFoundException('Usuario no encontrado');
      }

      console.log(
        `Código almacenado: ${user.verification_code}, Código ingresado: ${code}`,
      );
      console.log(
        `Fecha de expiración: ${user.verification_code_expires}, Fecha actual: ${new Date()}`,
      );

      // Verificar si el código es válido y no ha expirado
      if (user.verification_code !== code) {
        console.log('Código inválido');
        throw new UnauthorizedException('Código de verificación inválido');
      }

      if (new Date() > user.verification_code_expires) {
        console.log('Código expirado');
        throw new UnauthorizedException(
          'El código de verificación ha expirado',
        );
      }

      // Marcar email como verificado
      user.is_email_verified = true;
      user.verification_code = null;
      user.verification_code_expires = null;
      await this.userRepository.save(user);

      return {
        message: 'Email verificado correctamente',
        is_verified: true,
      };
    } catch (error) {
      console.error('Error en verificación de email:', error);
      throw error;
    }
  }

  async getEmployeesByOwner(ownerId: string) {
    return await this.userRepository.find({
      where: { owner: { id: ownerId } },
      relations: ['roles'],
    });
  }

  async getEmployeeByOwner(ownerId: string, employeeId: string) {
    const employee = await this.userRepository.findOne({
      where: {
        id: employeeId,
        owner: { id: ownerId },
      },
      relations: ['roles'],
    });

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return employee;
  }

  private getJwtToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }

  async generatePasswordResetCode(email: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Generar código de 6 dígitos
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Establecer expiración (30 minutos)
      const expires = new Date();
      expires.setMinutes(expires.getMinutes() + 30);

      // Guardar en el usuario
      user.reset_password_code = code;
      user.reset_password_expires = expires;
      await this.userRepository.save(user);

      // Enviar email
      const emailSent = await this.emailService.sendPasswordResetCode(
        email,
        code,
      );

      if (!emailSent) {
        throw new InternalServerErrorException(
          'Error al enviar el código de recuperación',
        );
      }

      return { message: 'Código de recuperación enviado' };
    } catch (error) {
      console.error('Error generando código de recuperación:', error);
      throw error;
    }
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    try {
      const user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      console.log(
        `Código almacenado: ${user.reset_password_code}, Código ingresado: ${code}`,
      );
      console.log(
        `Fecha de expiración: ${user.reset_password_expires}, Fecha actual: ${new Date()}`,
      );

      // Verificar si el código es válido y no ha expirado
      if (user.reset_password_code !== code) {
        throw new UnauthorizedException('Código de recuperación inválido');
      }

      if (
        !user.reset_password_expires ||
        new Date() > user.reset_password_expires
      ) {
        throw new UnauthorizedException(
          'El código de recuperación ha expirado',
        );
      }

      // Actualizar la contraseña
      user.password = await this.hashPassword(newPassword);
      user.reset_password_code = null;
      user.reset_password_expires = null;
      await this.userRepository.save(user);

      return {
        message: 'Contraseña actualizada correctamente',
      };
    } catch (error) {
      console.error('Error restableciendo contraseña:', error);
      throw error;
    }
  }
}
