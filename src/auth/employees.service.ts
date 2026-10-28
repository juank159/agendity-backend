import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  FindManyOptions,
  Repository,
} from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Role } from 'src/roles/entities/role.entity';
import { UserService } from 'src/user-services/entities/user-service.entity';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  UserAccessActor,
  assertCanManageUser,
  canBeScheduled,
} from 'src/users/user-access';
import { AuthUser } from './interfaces';
import { CreateEmployeeDto } from './dto';
import { CreateEmployeeWithDetailsDto } from './dto/create-employee-with-details.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ToggleEmployeeStatusDto } from './dto/toggle-employee-status.dto';
import { VerificationAttemptsService } from './verification-attempts.service';
import {
  assertEmailAndPhoneAvailable,
  assertValidCode,
  duplicateUserError,
  findRole,
  findUserWithSecrets,
  hashPassword,
  toUserResponse,
} from './user-accounts';

/**
 * Gestión de los empleados de un negocio (5.05: separada de `AuthService`).
 * Las rutas siguen en `AuthController` (`/auth/employee*`, solo Owner): el
 * contrato HTTP no cambió. Todas las consultas se limitan a los empleados del
 * Owner que llama (`owner.id`); uno ajeno responde 404.
 */
@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly dataSource: DataSource,
    private readonly verificationAttempts: VerificationAttemptsService,
  ) {}

  async createEmployee(
    createEmployeeDto: CreateEmployeeDto | CreateEmployeeWithDetailsDto,
    owner: AuthUser,
  ) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await assertEmailAndPhoneAvailable(
          this.userRepository,
          createEmployeeDto.email,
          createEmployeeDto.phone,
        );

        const employeeRole = await findRole(this.roleRepository, 'Employee');

        // `CreateEmployeeWithDetailsDto` trae además servicios y horarios en arreglo.
        let services: any[] = [];
        let schedules: any[] = [];
        if (
          'services' in createEmployeeDto ||
          'schedules' in createEmployeeDto
        ) {
          const withDetailsDto =
            createEmployeeDto as CreateEmployeeWithDetailsDto;
          services = withDetailsDto.services || [];
          schedules = withDetailsDto.schedules || [];
        }

        const { password, schedule, ...userData } = createEmployeeDto;

        const newEmployee = manager.create(User, {
          ...userData,
          password: await hashPassword(password),
          roles: [employeeRole],
          owner: { id: owner.id } as User,
          // Hereda el tenant del Owner (antes quedaba NULL: el JWT no lo traía).
          tenant_id: owner.tenantId,
          ...initialEmployeeState(),
        });

        await manager.save(newEmployee);

        if (services && services.length > 0) {
          await manager.save(
            userServiceRows(manager, newEmployee.id, services),
          );
        }

        if (schedule && typeof schedule === 'object') {
          // Horario por día (formato de la app).
          const userSchedules = [];
          for (const [day, hours] of Object.entries(schedule)) {
            if (
              DAY_NUMBERS[day] &&
              hours &&
              typeof hours === 'object' &&
              'start' in hours &&
              'end' in hours
            ) {
              userSchedules.push(
                manager.create(Schedule, {
                  user: newEmployee,
                  day_of_week: DAY_NUMBERS[day],
                  start_time: hours.start as string,
                  end_time: hours.end as string,
                  is_available: true,
                }),
              );
            }
          }

          if (userSchedules.length > 0) {
            await manager.save(userSchedules);
          }
        } else if (schedules && schedules.length > 0) {
          // Horarios en arreglo (`CreateEmployeeWithDetailsDto`).
          const userSchedules = schedules.map((item) => {
            if ('user_id' in item) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { user_id, ...scheduleData } = item;
              return manager.create(Schedule, {
                ...scheduleData,
                user: newEmployee,
              });
            }
            return manager.create(Schedule, { ...item, user: newEmployee });
          });

          await manager.save(userSchedules);
        }

        const employeeWithRelations = await manager.findOne(User, {
          where: { id: newEmployee.id },
          relations: ['roles', 'owner', 'schedules'],
        });

        // Sin `token`: el Owner no debe recibir una sesión del empleado (2.12).
        return {
          user: toUserResponse(employeeWithRelations),
        };
      });
    } catch (error) {
      if (!(error instanceof HttpException)) {
        this.logger.error(`Error en createEmployee: ${error?.message}`);
      }
      throw error;
    }
  }

  async updateEmployee(
    ownerId: string,
    employeeId: string,
    updateData: UpdateEmployeeDto,
  ) {
    try {
      return await this.dataSource.transaction(async (manager) => {
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

        // Email y teléfono nuevos no pueden ser de otra cuenta.
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
            throw duplicateUserError(
              existingUser.email === updateData.email,
              updateData.email,
              updateData.phone,
            );
          }
        }

        if (updateData.password) {
          employee.password = await hashPassword(updateData.password);
        }

        if (updateData.name) employee.name = updateData.name;
        if (updateData.lastname) employee.lastname = updateData.lastname;
        if (emailChanges(employee.email, updateData.email)) {
          // Regla 2.33 (coherente con 2.16): un email nuevo vuelve a exigir
          // verificación; el empleado queda inactivo hasta verificarlo.
          Object.assign(employee, initialEmployeeState(), {
            verification_code: null,
            verification_code_expires: null,
          });
        }
        if (updateData.email) employee.email = updateData.email;
        if (updateData.phone) employee.phone = updateData.phone;

        await manager.save(employee);

        // Horario: si llega, sustituye al anterior.
        if (updateData.schedule && typeof updateData.schedule === 'object') {
          await manager.delete(Schedule, { user: { id: employeeId } });

          const schedules = [];
          for (const [day, hours] of Object.entries(updateData.schedule)) {
            if (DAY_NUMBERS[day] && hours && hours.start && hours.end) {
              schedules.push(
                manager.create(Schedule, {
                  user: { id: employeeId },
                  day_of_week: DAY_NUMBERS[day],
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

        // Servicios: si llegan, sustituyen a los anteriores.
        if (updateData.services && Array.isArray(updateData.services)) {
          await manager.delete(UserService, { userId: employeeId });

          if (updateData.services.length > 0) {
            await manager.save(
              userServiceRows(manager, employeeId, updateData.services),
            );
          }
        }

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

        return employeeResponse(updatedEmployee);
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`Error al actualizar empleado: ${error?.message}`);
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
      // El dueño no se borra (2.33: antes daba 404, porque se buscaba entre
      // los empleados del Owner y el Owner no es su propio empleado).
      if (employeeId === ownerId) {
        throw ownerNotDeletable();
      }

      // Con borrados (2.33: sin `withDeleted` el 409 "ya eliminado" era
      // inalcanzable → 404).
      const employee = await this.userRepository.findOne({
        where: {
          id: employeeId,
          owner: { id: ownerId },
        },
        relations: ['roles', 'owner'],
        withDeleted: true,
      });

      if (!employee) {
        throw new NotFoundException('Empleado no encontrado');
      }

      if (employee.roles.some((role) => role.name === 'Owner')) {
        throw ownerNotDeletable();
      }

      if (employee.deletedAt) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          'El empleado ya ha sido eliminado previamente',
        );
      }

      await this.userRepository.softDelete(employeeId);

      // Inactivo: no puede iniciar sesión ni recibir citas.
      await this.userRepository.update(employeeId, {
        isActive: false,
        deletionReason: deletionReason || 'Eliminado por administrador',
        deletedBy: ownerId,
      });

      return {
        message: 'Profesional eliminado correctamente',
        id: employeeId,
        deletedAt: new Date(),
        reason: deletionReason || 'Eliminado por administrador',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error eliminando el empleado ${employeeId}: ${error?.message}`,
      );
      throw new InternalServerErrorException('Error al eliminar el empleado');
    }
  }

  async restoreEmployee(ownerId: string, employeeId: string) {
    const employee = await this.userRepository.findOne({
      where: {
        id: employeeId,
        owner: { id: ownerId },
      },
      relations: ['roles', 'owner'],
      withDeleted: true,
    });

    if (!employee || !employee.deletedAt) {
      throw new NotFoundException('Empleado eliminado no encontrado');
    }

    await this.userRepository.restore(employeeId);

    // Reactivar solo si verificó su email (2.15). Si no, se restaura
    // inactivo: el Owner lo activa al verificar (`verify/employee-email`).
    const isActive = canActivateEmployee(employee);
    await this.userRepository.update(employeeId, {
      isActive,
      deletionReason: null,
      deletedBy: null,
    });

    return {
      message: isActive
        ? 'Empleado restaurado correctamente'
        : 'Empleado restaurado. Debe verificar su email para activarse',
      id: employeeId,
      isActive,
      restoredAt: new Date(),
    };
  }

  /** El Owner y sus empleados (con los borrados si `includeDeleted`). */
  async getEmployeesByOwner(ownerId: string, includeDeleted: boolean = false) {
    const relations = [
      'roles',
      'userServices',
      'userServices.service',
      'schedules',
    ];
    const employeesOptions: FindManyOptions<User> = {
      where: { owner: { id: ownerId } },
      relations,
    };
    const ownerOptions: FindManyOptions<User> = {
      where: { id: ownerId },
      relations,
    };
    if (includeDeleted) {
      employeesOptions.withDeleted = true;
      ownerOptions.withDeleted = true;
    }

    const employees = await this.userRepository.find(employeesOptions);
    const owner = await this.userRepository.findOne(ownerOptions);

    if (!owner) {
      throw new NotFoundException('Propietario no encontrado');
    }

    return [owner, ...employees].map((user) => {
      const { services, schedule, ...userData } = employeeResponse(user);
      return {
        ...userData,
        isOwner: user.id === ownerId,
        isDeleted: !!user.deletedAt,
        deletedAt: user.deletedAt,
        deletionReason: user.deletionReason,
        services,
        schedule,
      };
    });
  }

  /**
   * Profesionales que se pueden agendar (2.33): misma regla que crear o mover
   * una cita (`canBeScheduled`). Incluye al Owner si es agendable.
   */
  async getActiveEmployeesByOwner(ownerId: string) {
    const all = await this.getEmployeesByOwner(ownerId, false);
    return all.filter((user) => canBeScheduled(user, ownerId));
  }

  async getDeletedEmployeesByOwner(ownerId: string) {
    const employees = await this.userRepository.find({
      where: {
        owner: { id: ownerId },
      },
      relations: ['roles', 'userServices', 'userServices.service', 'schedules'],
      withDeleted: true,
    });

    return employees
      .filter((employee) => employee.deletedAt)
      .map((user) => ({
        ...toUserResponse(user),
        isDeleted: true,
        deletedAt: user.deletedAt,
        deletionReason: user.deletionReason,
      }));
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

    return employeeResponse(employee);
  }

  /**
   * Activa o desactiva un empleado del Owner (404 si es de otro negocio).
   * Regla del usuario (2.15): activar exige el email verificado
   * (`EMAIL_NOT_VERIFIED`, 409). `verify/employee-email` ya activa al verificar.
   */
  async toggleEmployeeStatus(
    ownerId: string,
    employeeId: string,
    statusData: ToggleEmployeeStatusDto,
  ) {
    try {
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

      if (statusData.isActive) {
        assertCanActivateEmployee(employee);
      }
      employee.isActive = statusData.isActive;
      await this.userRepository.save(employee);

      const updatedEmployee = await this.userRepository.findOne({
        where: { id: employeeId },
        relations: ['roles', 'owner'],
      });

      return toUserResponse(updatedEmployee);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error al cambiar el estado del empleado: ${error?.message}`,
      );
      throw new InternalServerErrorException(
        'Error al actualizar el estado del empleado',
      );
    }
  }

  async verifyEmployeeEmail(
    owner: UserAccessActor,
    employeeId: string,
    code: string,
  ) {
    // Solo empleados del Owner que llama (404 si es de otro negocio).
    await assertCanManageUser(
      this.userRepository,
      owner,
      { id: employeeId },
      { employeesOnly: true },
    );
    const employee = await findUserWithSecrets(
      this.userRepository,
      { id: employeeId },
      ['verification_code', 'verification_code_expires'],
    );

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    await assertValidCode(
      { users: this.userRepository, attempts: this.verificationAttempts },
      'verify',
      employee,
      code,
    );

    employee.isActive = true;
    employee.is_email_verified = true;
    employee.verification_code = null;
    employee.verification_code_expires = null;
    await this.userRepository.save(employee);

    return {
      message: 'Email verificado y empleado activado correctamente',
      is_verified: true,
    };
  }
}

/** Día de la app → `schedules.day_of_week` (ISO: lunes = 1). */
const DAY_NUMBERS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const DAY_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(DAY_NUMBERS).map(([name, number]) => [number, name]),
);

function userServiceRows(
  manager: EntityManager,
  employeeId: string,
  services: {
    serviceId: string;
    customPrice?: number;
    commissionPercentage?: number;
    isActive?: boolean;
  }[],
): UserService[] {
  return services.map((service) =>
    manager.create(UserService, {
      userId: employeeId,
      serviceId: service.serviceId,
      customPrice: service.customPrice,
      commissionPercentage: service.commissionPercentage || 0,
      isActive: service.isActive !== undefined ? service.isActive : true,
    }),
  );
}

/**
 * Empleado para la app: datos sin secretos, servicios asignados y horario por
 * día (`{ monday: { start, end } }`). `user` trae `userServices.service` y
 * `schedules`.
 */
function employeeResponse(user: User) {
  const schedule = {};
  for (const item of user.schedules ?? []) {
    const day = DAY_NAMES[item.day_of_week];
    if (day) {
      schedule[day] = { start: item.start_time, end: item.end_time };
    }
  }
  return {
    ...toUserResponse(user),
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
}

/** Regla del usuario (2.15): solo se activa un empleado con el email verificado. */
export function canActivateEmployee(employee: {
  is_email_verified?: boolean;
}): boolean {
  return employee?.is_email_verified === true;
}

/**
 * Regla del usuario (2.16): un empleado nace inactivo y sin verificar; lo
 * activa `verify/employee-email`. No hay alta con el email ya verificado:
 * `createEmployee` rechaza cualquier email existente, y el DTO no admite
 * `isActive` ni `is_email_verified`. Se fija aquí porque el default de la
 * columna `isActive` es `true` (lo siguen usando el Owner y el login con Google).
 */
export function initialEmployeeState(): {
  isActive: boolean;
  is_email_verified: boolean;
} {
  const is_email_verified = false;
  return {
    is_email_verified,
    isActive: canActivateEmployee({ is_email_verified }),
  };
}

export function assertCanActivateEmployee(employee: {
  is_email_verified?: boolean;
}): void {
  if (!canActivateEmployee(employee)) {
    throw new BusinessException(
      ErrorCode.EMAIL_NOT_VERIFIED,
      'El profesional debe verificar su email antes de activarse',
    );
  }
}

/**
 * ¿El email de un empleado cambia de verdad? (2.33). Solo mayúsculas o
 * espacios distintos no cuentan como email nuevo.
 */
export function emailChanges(
  current: string | null | undefined,
  next: string | null | undefined,
): boolean {
  if (!next) return false;
  const normalize = (email: string | null | undefined) =>
    (email ?? '').trim().toLowerCase();
  return normalize(next) !== normalize(current);
}

/** Borrar al dueño del negocio: 409 `OWNER_NOT_DELETABLE` (2.33; antes 403 legado). */
function ownerNotDeletable(): BusinessException {
  return new BusinessException(
    ErrorCode.OWNER_NOT_DELETABLE,
    'No se puede eliminar al dueño del negocio',
  );
}
