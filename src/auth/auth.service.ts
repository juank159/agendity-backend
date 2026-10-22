import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateAuthDto, CreateEmployeeDto, LoginAuthDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';
import {
  User,
  UserSecretField,
  omitUserSecrets,
} from 'src/users/entities/user.entity';
import { Not, Repository, DataSource, FindOptionsWhere } from 'typeorm';
import { UserAccessActor, assertCanManageUser } from 'src/users/user-access';
import * as bcrypt from 'bcrypt';
import { randomInt, timingSafeEqual } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from './interfaces';
import { Role } from 'src/roles/entities/role.entity';
import { v4 as uuid } from 'uuid';
import { OAuth2Client } from 'google-auth-library';
import { ConfigService } from '@nestjs/config';
import { EmailService } from 'src/email/email.service';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UserService } from 'src/user-services/entities/user-service.entity';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { UserServicesService } from 'src/user-services/user-services.service';
import { SchedulesService } from 'src/schedules/schedules.service';
import { CreateEmployeeWithDetailsDto } from './dto/create-employee-with-details.dto';
import { ToggleEmployeeStatusDto } from './dto/toggle-employee-status.dto';
import {
  VerificationAttemptsService,
  VerificationPurpose,
} from './verification-attempts.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client;
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => UserServicesService))
    private readonly userServicesService: UserServicesService,
    @Inject(forwardRef(() => SchedulesService))
    private readonly schedulesService: SchedulesService,
    private readonly verificationAttempts: VerificationAttemptsService,
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

  /**
   * Las columnas secretas de `User` tienen `select: false`. Solo los flujos que
   * comparan contraseña o códigos las piden aquí, de forma explícita.
   */
  private findUserWithSecrets(
    where: FindOptionsWhere<User>,
    secrets: UserSecretField[],
    relations: string[] = [],
  ): Promise<User | null> {
    const qb = this.userRepository.createQueryBuilder('user').where(where);
    for (const field of secrets) {
      qb.addSelect(`user.${field}`);
    }
    for (const relation of relations) {
      qb.leftJoinAndSelect(`user.${relation}`, relation);
    }
    return qb.getOne();
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

  /**
   * Comprueba un código de verificación o de reset. Cada fallo cuenta; al llegar a
   * MAX_CODE_ATTEMPTS el código se borra de la BD y hay que pedir uno nuevo.
   * `user` debe traer las columnas del código (`findUserWithSecrets`).
   */
  private async assertValidCode(
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

    if (!this.codesMatch(stored, input)) {
      const exhausted = this.verificationAttempts.registerFailure(
        purpose,
        user.id,
      );
      if (exhausted) {
        if (stored) await this.invalidateCode(purpose, user.id);
        this.verificationAttempts.reset(purpose, user.id);
        throw new UnauthorizedException(
          'Demasiados intentos fallidos. Solicita un código nuevo.',
        );
      }
      throw new UnauthorizedException(
        purpose === 'reset'
          ? 'Código de recuperación inválido'
          : 'Código de verificación inválido',
      );
    }

    if (!expires || new Date() > expires) {
      throw new UnauthorizedException(
        purpose === 'reset'
          ? 'El código de recuperación ha expirado'
          : 'El código de verificación ha expirado',
      );
    }
    this.verificationAttempts.reset(purpose, user.id);
  }

  private codesMatch(stored: string | null, input: unknown): boolean {
    if (!stored || typeof input !== 'string') return false;
    const a = Buffer.from(stored);
    const b = Buffer.from(input);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async invalidateCode(
    purpose: VerificationPurpose,
    userId: string,
  ): Promise<void> {
    await this.userRepository.update(
      userId,
      purpose === 'reset'
        ? { reset_password_code: null, reset_password_expires: null }
        : { verification_code: null, verification_code_expires: null },
    );
  }

  private transformUserResponse(user: User) {
    const userData = omitUserSecrets(user);
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

  async createEmployee(
    createEmployeeDto: CreateEmployeeDto | CreateEmployeeWithDetailsDto,
    owner: User,
  ) {
    try {
      // Usamos transacción para asegurar consistencia
      return await this.dataSource.transaction(async (manager) => {
        await this.validateUserExists(
          createEmployeeDto.email,
          createEmployeeDto.phone,
        );

        const employeeRole = await this.getRole('Employee');

        // Verificar si es CreateEmployeeWithDetailsDto (que tiene services y schedules)
        const isWithDetails =
          'services' in createEmployeeDto || 'schedules' in createEmployeeDto;

        // Extraer los datos según el tipo de DTO
        let services: any[] = [];
        let schedules: any[] = [];

        if (isWithDetails) {
          const withDetailsDto =
            createEmployeeDto as CreateEmployeeWithDetailsDto;
          services = withDetailsDto.services || [];
          schedules = withDetailsDto.schedules || [];
        }

        // Extraer schedule del DTO original
        const { password, schedule, ...userData } = createEmployeeDto;

        // Crear el empleado base
        const newEmployee = manager.create(User, {
          ...userData,
          password: await this.hashPassword(password),
          roles: [employeeRole],
          owner: owner,
          tenant_id: owner.tenant_id,
        });

        await manager.save(newEmployee);

        // Asignar servicios con sus porcentajes si existen
        if (services && services.length > 0) {
          console.log('Creando servicios para el empleado:', services);
          const userServices = services.map((service) =>
            manager.create(UserService, {
              userId: newEmployee.id,
              serviceId: service.serviceId,
              customPrice: service.customPrice,
              commissionPercentage: service.commissionPercentage || 0,
              isActive:
                service.isActive !== undefined ? service.isActive : true,
            }),
          );

          await manager.save(userServices);
        }

        // Asignar horarios si existe el schedule (formato de frontend)
        if (schedule && typeof schedule === 'object') {
          console.log('Creando horarios desde schedule:', schedule);

          // Mapeo de días a números
          const dayMap = {
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6,
            sunday: 7,
          };

          const userSchedules = [];

          // Procesar cada día del schedule
          for (const [day, hours] of Object.entries(schedule)) {
            // Verificar tipo de 'hours' antes de acceder a propiedades
            if (
              dayMap[day] &&
              hours &&
              typeof hours === 'object' &&
              'start' in hours &&
              'end' in hours
            ) {
              userSchedules.push(
                manager.create(Schedule, {
                  user: newEmployee,
                  day_of_week: dayMap[day],
                  start_time: hours.start as string,
                  end_time: hours.end as string,
                  is_available: true,
                }),
              );
              console.log(
                `Creando horario para ${day}: ${hours.start}-${hours.end}`,
              );
            }
          }

          if (userSchedules.length > 0) {
            await manager.save(userSchedules);
            console.log(
              `Guardados ${userSchedules.length} horarios para el empleado`,
            );
          }
        }

        // Asignar horarios si existen en formato de arreglo (compatible con código existente)
        else if (schedules && schedules.length > 0) {
          console.log('Creando horarios desde schedules array:', schedules);
          const userSchedules = schedules.map((schedule) => {
            // Verificar si user_id existe antes de desestructurar
            if ('user_id' in schedule) {
              const { user_id, ...scheduleData } = schedule;
              return manager.create(Schedule, {
                ...scheduleData,
                user: newEmployee,
              });
            } else {
              return manager.create(Schedule, {
                ...schedule,
                user: newEmployee,
              });
            }
          });

          await manager.save(userSchedules);
        }

        // Cargar el empleado con sus relaciones para la respuesta
        const employeeWithRelations = await manager.findOne(User, {
          where: { id: newEmployee.id },
          relations: ['roles', 'owner', 'schedules'], // Añadir relación con schedules
        });

        return {
          user: this.transformUserResponse(employeeWithRelations),
          token: this.generateToken(employeeWithRelations),
        };
      });
    } catch (error) {
      console.error('Error en createEmployee:', error);
      throw error;
    }
  }

  // auth.service.ts - método updateEmployee
  async updateEmployee(
    ownerId: string,
    employeeId: string,
    updateData: UpdateEmployeeDto,
  ) {
    try {
      // Usamos transacción para garantizar consistencia
      return await this.dataSource.transaction(async (manager) => {
        // 1. Buscar el empleado actual incluyendo sus roles
        const employee = await manager.findOne(User, {
          where: {
            id: employeeId,
            owner: { id: ownerId },
          },
          relations: ['roles', 'owner'],
        });

        if (!employee) {
          throw new NotFoundException('Empleado no encontrado');
        }

        // 2. Validar email y teléfono
        if (
          (updateData.email && updateData.email !== employee.email) ||
          (updateData.phone && updateData.phone !== employee.phone)
        ) {
          const duplicateQuery = [];

          if (updateData.email && updateData.email !== employee.email) {
            duplicateQuery.push({ email: updateData.email });
          }

          if (updateData.phone && updateData.phone !== employee.phone) {
            duplicateQuery.push({ phone: updateData.phone });
          }

          if (duplicateQuery.length > 0) {
            const existingUser = await manager.findOne(User, {
              where: duplicateQuery,
            });

            if (existingUser && existingUser.id !== employeeId) {
              const duplicatedField =
                existingUser.email === updateData.email ? 'email' : 'teléfono';
              const duplicatedValue =
                duplicatedField === 'email'
                  ? updateData.email
                  : updateData.phone;
              throw new ConflictException(
                `Ya existe un usuario con el ${duplicatedField}: ${duplicatedValue}`,
              );
            }
          }
        }

        // 3. Manejar la contraseña
        if (updateData.password) {
          employee.password = await this.hashPassword(updateData.password);
        }

        // 4. Actualizar el resto de datos básicos
        if (updateData.name) employee.name = updateData.name;
        if (updateData.lastname) employee.lastname = updateData.lastname;
        if (updateData.email) employee.email = updateData.email;
        if (updateData.phone) employee.phone = updateData.phone;

        // 5. Guardar los cambios básicos del empleado
        await manager.save(employee);

        // 6. Actualizar el horario si se proporciona
        if (updateData.schedule && typeof updateData.schedule === 'object') {
          // Primero, eliminar horarios existentes
          await manager.delete(Schedule, { user: { id: employeeId } });

          // Mapeo de días a números
          const dayMap = {
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6,
            sunday: 7,
          };

          // Crear nuevos horarios
          const schedules = [];
          for (const [day, hours] of Object.entries(updateData.schedule)) {
            if (dayMap[day] && hours && hours.start && hours.end) {
              schedules.push(
                manager.create(Schedule, {
                  user: { id: employeeId },
                  day_of_week: dayMap[day],
                  start_time: hours.start,
                  end_time: hours.end,
                  is_available: true,
                }),
              );
            }
          }

          if (schedules.length > 0) {
            await manager.save(schedules);
          }
        }

        // 7. Actualizar servicios si se proporcionan
        if (updateData.services && Array.isArray(updateData.services)) {
          // Eliminar asignaciones existentes
          await manager.delete(UserService, { userId: employeeId });

          // Crear nuevas asignaciones
          if (updateData.services.length > 0) {
            const userServices = updateData.services.map((service) =>
              manager.create(UserService, {
                userId: employeeId,
                serviceId: service.serviceId,
                customPrice: service.customPrice,
                commissionPercentage: service.commissionPercentage || 0,
                isActive:
                  service.isActive !== undefined ? service.isActive : true,
              }),
            );

            await manager.save(userServices);
          }
        }

        // 8. Cargar y devolver el empleado actualizado con todas sus relaciones
        const updatedEmployee = await manager.findOne(User, {
          where: { id: employeeId },
          relations: [
            'roles',
            'owner',
            'userServices',
            'userServices.service',
            'schedules',
          ],
        });

        if (!updatedEmployee) {
          throw new NotFoundException(
            'No se pudo encontrar el empleado después de actualizarlo',
          );
        }

        // 9. Convertir el horario al formato esperado por el frontend
        const schedule = {};
        if (updatedEmployee.schedules && updatedEmployee.schedules.length > 0) {
          const dayMap = {
            1: 'monday',
            2: 'tuesday',
            3: 'wednesday',
            4: 'thursday',
            5: 'friday',
            6: 'saturday',
            7: 'sunday',
          };

          updatedEmployee.schedules.forEach((scheduleItem) => {
            const day = dayMap[scheduleItem.day_of_week];
            if (day) {
              schedule[day] = {
                start: scheduleItem.start_time,
                end: scheduleItem.end_time,
              };
            }
          });
        }

        // 10. Construir y devolver la respuesta
        const userData = omitUserSecrets(updatedEmployee);
        return {
          ...userData,
          roles: userData.roles.map((role) => ({ name: role.name })),
          services:
            updatedEmployee.userServices?.map((us) => ({
              id: us.service.id,
              name: us.service.name,
              commissionPercentage: us.commissionPercentage || 0,
              customPrice: us.customPrice,
              originalPrice: us.service.price,
              isActive: us.isActive,
            })) || [],
          schedule,
        };
      });
    } catch (error) {
      // Propagar errores conocidos, envolver errores desconocidos
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Error al actualizar empleado:', error);
      throw new InternalServerErrorException(
        `Error al actualizar el empleado: ${error.message}`,
      );
    }
  }

  async deleteEmployee(
    ownerId: string,
    employeeId: string,
    deletionReason?: string,
  ) {
    try {
      console.log(
        `🗑️ Iniciando soft delete de empleado ${employeeId} por owner ${ownerId}`,
      );

      // 1. Buscar el empleado verificando que pertenezca al owner
      const employee = await this.userRepository.findOne({
        where: {
          id: employeeId,
          owner: { id: ownerId },
        },
        relations: ['roles', 'owner'],
      });

      if (!employee) {
        throw new NotFoundException('Empleado no encontrado');
      }

      // 2. Verificar que no sea el dueño
      const isOwner = employee.roles.some((role) => role.name === 'Owner');
      if (isOwner) {
        throw new ForbiddenException(
          'No se puede eliminar al dueño del negocio',
        );
      }

      // 3. Verificar que no esté ya eliminado
      if (employee.deletedAt) {
        throw new ConflictException(
          'El empleado ya ha sido eliminado previamente',
        );
      }

      // 4. SOFT DELETE usando TypeORM
      await this.userRepository.softDelete(employeeId);

      // 5. Desactivar al empleado (para que no pueda hacer login ni agendar citas)
      await this.userRepository.update(employeeId, {
        isActive: false,
        deletionReason: deletionReason || 'Eliminado por administrador',
        deletedBy: ownerId,
      });

      console.log(
        `✅ Empleado ${employeeId} eliminado exitosamente (soft delete)`,
      );

      return {
        message: 'Profesional eliminado correctamente',
        id: employeeId,
        deletedAt: new Date(),
        reason: deletionReason || 'Eliminado por administrador',
      };
    } catch (error) {
      console.error(`❌ Error eliminando empleado ${employeeId}:`, error);

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      throw new InternalServerErrorException('Error al eliminar el empleado');
    }
  }

  async restoreEmployee(ownerId: string, employeeId: string) {
    try {
      console.log(`♻️ Restaurando empleado ${employeeId}`);

      // Buscar empleado eliminado (withDeleted: true incluye soft-deleted)
      const employee = await this.userRepository.findOne({
        where: {
          id: employeeId,
          owner: { id: ownerId },
        },
        relations: ['roles', 'owner'],
        withDeleted: true, // ⭐ IMPORTANTE: Incluir registros soft-deleted
      });

      if (!employee || !employee.deletedAt) {
        throw new NotFoundException('Empleado eliminado no encontrado');
      }

      // Verificar permisos
      if (employee.owner?.id !== ownerId) {
        throw new ForbiddenException(
          'No tienes permisos para restaurar este empleado',
        );
      }

      // Restaurar empleado
      await this.userRepository.restore(employeeId);

      // Reactivar empleado
      await this.userRepository.update(employeeId, {
        isActive: true,
        deletionReason: null,
        deletedBy: null,
      });

      console.log(`✅ Empleado ${employeeId} restaurado exitosamente`);

      return {
        message: 'Empleado restaurado correctamente',
        id: employeeId,
        restoredAt: new Date(),
      };
    } catch (error) {
      console.error(`❌ Error restaurando empleado ${employeeId}:`, error);
      throw error;
    }
  }

  async login(loginAuthDto: LoginAuthDto) {
    try {
      const { email, password } = loginAuthDto;
      const user = await this.findUserWithSecrets(
        { email },
        ['password'],
        ['roles', 'owner'],
      );

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

  async generateVerificationCode(email: string, isNewUser: boolean = false) {
    try {
      let user = await this.userRepository.findOne({ where: { email } });

      if (!user) {
        if (!isNewUser) {
          throw new NotFoundException('Usuario no encontrado');
        }
        // Registro temporal hasta completar el alta.
        user = this.userRepository.create({
          email: email,
          is_email_verified: false,
          name: 'Pendiente',
          lastname: 'Pendiente',
          phone: 'Pendiente',
          // Nunca en texto plano: contraseña aleatoria con hash hasta el registro real.
          password: await this.hashPassword(uuid()),
          is_google_account: false,
        });
      }

      const code = this.generateCode();
      user.verification_code = code;
      user.verification_code_expires = this.codeExpiry();
      await this.userRepository.save(user);
      this.verificationAttempts.reset('verify', user.id);

      let emailSent: boolean;
      try {
        emailSent = await this.emailService.sendVerificationCode(email, code);
      } catch (emailError) {
        this.logger.error(
          `Error enviando el código de verificación: ${emailError.message}`,
        );
        throw new InternalServerErrorException(
          'Error al enviar el código de verificación',
        );
      }
      if (!emailSent) {
        throw new InternalServerErrorException(
          'Error al enviar el código de verificación',
        );
      }

      return { message: 'Código de verificación enviado' };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
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

  async verifyEmail(email: string, code: string) {
    const user = await this.findUserWithSecrets({ email }, [
      'verification_code',
      'verification_code_expires',
    ]);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.assertValidCode('verify', user, code);

    user.is_email_verified = true;
    user.verification_code = null;
    user.verification_code_expires = null;
    await this.userRepository.save(user);

    return {
      message: 'Email verificado correctamente',
      is_verified: true,
    };
  }

  async getEmployeesByOwner(ownerId: string, includeDeleted: boolean = false) {
    try {
      console.log(
        `📋 Obteniendo empleados para owner ${ownerId}, incluir eliminados: ${includeDeleted}`,
      );

      const options: any = {
        where: { owner: { id: ownerId } },
        relations: [
          'roles',
          'userServices',
          'userServices.service',
          'schedules',
        ],
      };

      // Si se quieren incluir empleados eliminados
      if (includeDeleted) {
        options.withDeleted = true;
      }

      const employees = await this.userRepository.find(options);

      // También obtener el owner
      const ownerOptions: any = {
        where: { id: ownerId },
        relations: [
          'roles',
          'userServices',
          'userServices.service',
          'schedules',
        ],
      };

      if (includeDeleted) {
        ownerOptions.withDeleted = true;
      }

      const owner = await this.userRepository.findOne(ownerOptions);

      if (!owner) {
        throw new NotFoundException('Propietario no encontrado');
      }

      // Combinar resultados
      const allUsers = [owner, ...employees];

      // Transformar respuesta
      return allUsers.map((user) => {
        const userData = omitUserSecrets(user);

        // Convertir schedules a formato de frontend
        const schedule = {};
        if (user.schedules && user.schedules.length > 0) {
          const dayMap = {
            1: 'monday',
            2: 'tuesday',
            3: 'wednesday',
            4: 'thursday',
            5: 'friday',
            6: 'saturday',
            7: 'sunday',
          };

          user.schedules.forEach((scheduleItem) => {
            const day = dayMap[scheduleItem.day_of_week];
            if (day) {
              schedule[day] = {
                start: scheduleItem.start_time,
                end: scheduleItem.end_time,
              };
            }
          });
        }

        return {
          ...userData,
          roles: userData.roles.map((role) => ({ name: role.name })),
          isOwner: user.id === ownerId,
          isDeleted: !!user.deletedAt, // 🆕 Indicar si está eliminado
          deletedAt: user.deletedAt,
          deletionReason: user.deletionReason,
          services:
            user.userServices?.map((us) => ({
              id: us.service.id,
              name: us.service.name,
              commissionPercentage: us.commissionPercentage || 0,
              customPrice: us.customPrice,
              originalPrice: us.service.price,
              isActive: us.isActive,
            })) || [],
          schedule,
        };
      });
    } catch (error) {
      console.error('❌ Error obteniendo empleados:', error);
      throw error;
    }
  }

  // 🆕 NUEVO: Método para obtener solo empleados activos (no eliminados)
  async getActiveEmployeesByOwner(ownerId: string) {
    return this.getEmployeesByOwner(ownerId, false);
  }

  // 🆕 NUEVO: Método para obtener empleados eliminados
  async getDeletedEmployeesByOwner(ownerId: string) {
    try {
      const employees = await this.userRepository.find({
        where: {
          owner: { id: ownerId },
        },
        relations: [
          'roles',
          'userServices',
          'userServices.service',
          'schedules',
        ],
        withDeleted: true, // Incluir eliminados
      });

      // Filtrar solo los eliminados
      const deletedEmployees = employees.filter((emp) => emp.deletedAt);

      return deletedEmployees.map((user) => {
        const userData = omitUserSecrets(user);
        return {
          ...userData,
          roles: userData.roles.map((role) => ({ name: role.name })),
          isDeleted: true,
          deletedAt: user.deletedAt,
          deletionReason: user.deletionReason,
        };
      });
    } catch (error) {
      console.error('❌ Error obteniendo empleados eliminados:', error);
      throw error;
    }
  }

  async getEmployeeByOwner(ownerId: string, employeeId: string) {
    const employee = await this.userRepository.findOne({
      where: {
        id: employeeId,
        owner: { id: ownerId },
      },
      relations: ['roles', 'userServices', 'userServices.service', 'schedules'],
    });

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    // Convertir schedules a formato de frontend
    const schedule = {};
    if (employee.schedules && employee.schedules.length > 0) {
      const dayMap = {
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
        7: 'sunday',
      };

      employee.schedules.forEach((scheduleItem) => {
        const day = dayMap[scheduleItem.day_of_week];
        if (day) {
          schedule[day] = {
            start: scheduleItem.start_time,
            end: scheduleItem.end_time,
          };
        }
      });
    }

    const userData = omitUserSecrets(employee);
    return {
      ...userData,
      roles: userData.roles.map((role) => ({ name: role.name })),
      services:
        employee.userServices?.map((us) => ({
          id: us.service.id,
          name: us.service.name,
          commissionPercentage: us.commissionPercentage || 0,
          customPrice: us.customPrice,
          originalPrice: us.service.price,
          isActive: us.isActive,
        })) || [],
      schedule, // Añadir el horario convertido
    };
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

      const code = this.generateCode();
      user.reset_password_code = code;
      user.reset_password_expires = this.codeExpiry();
      await this.userRepository.save(user);
      this.verificationAttempts.reset('reset', user.id);

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
      this.logger.error(
        `Error generando código de recuperación: ${error.message}`,
      );
      throw error;
    }
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await this.findUserWithSecrets({ email }, [
      'reset_password_code',
      'reset_password_expires',
    ]);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.assertValidCode('reset', user, code);

    user.password = await this.hashPassword(newPassword);
    user.reset_password_code = null;
    user.reset_password_expires = null;
    await this.userRepository.save(user);

    return {
      message: 'Contraseña actualizada correctamente',
    };
  }

  async toggleEmployeeStatus(
    ownerId: string,
    employeeId: string,
    statusData: ToggleEmployeeStatusDto,
    isEmailVerification: boolean = false,
  ) {
    try {
      // Si es verificación de email, buscamos el empleado directamente por ID
      let employee;

      if (isEmailVerification) {
        employee = await this.userRepository.findOne({
          where: { id: employeeId },
          relations: ['roles', 'owner'],
        });
      } else {
        // Buscar el empleado verificando que pertenezca al owner
        employee = await this.userRepository.findOne({
          where: {
            id: employeeId,
            owner: { id: ownerId },
          },
          relations: ['roles', 'owner'],
        });
      }

      if (!employee) {
        throw new NotFoundException('Empleado no encontrado');
      }

      // Actualizar el estado
      employee.isActive = statusData.isActive;

      // Si es verificación de email, también marcar como verificado
      if (isEmailVerification) {
        employee.is_email_verified = true;
      }

      // Guardar el cambio
      await this.userRepository.save(employee);

      // Retornar el empleado actualizado
      const updatedEmployee = await this.userRepository.findOne({
        where: { id: employeeId },
        relations: ['roles', 'owner'],
      });

      return this.transformUserResponse(updatedEmployee);
    } catch (error) {
      // Propagar errores conocidos, envolver errores desconocidos
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      console.error('Error al cambiar el estado del empleado:', error);
      throw new InternalServerErrorException(
        `Error al actualizar el estado del empleado: ${error.message}`,
      );
    }
  }

  async verifyEmployeeEmail(
    owner: UserAccessActor,
    employeeId: string,
    code: string,
  ) {
    try {
      // Solo empleados del Owner que llama (404 si es de otro negocio).
      await assertCanManageUser(
        this.userRepository,
        owner,
        { id: employeeId },
        { employeesOnly: true },
      );
      const employee = await this.findUserWithSecrets({ id: employeeId }, [
        'verification_code',
        'verification_code_expires',
      ]);

      if (!employee) {
        throw new NotFoundException('Empleado no encontrado');
      }

      await this.assertValidCode('verify', employee, code);

      // Activar el empleado
      employee.isActive = true;
      employee.is_email_verified = true;
      employee.verification_code = null;
      employee.verification_code_expires = null;
      await this.userRepository.save(employee);

      return {
        message: 'Email verificado y empleado activado correctamente',
        is_verified: true,
      };
    } catch (error) {
      throw error;
    }
  }
}
