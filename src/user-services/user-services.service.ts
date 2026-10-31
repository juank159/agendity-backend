import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser, isOnlyEmployee } from '../auth/interfaces';
import { tenantIdFrom } from '../common/decorators/tenant.decorator';
import { Service } from '../services/entities/service.entity';
import { effectiveCommission } from '../appointments/appointment-commission';
import { User } from '../users/entities/user.entity';
import { UserService } from './entities/user-service.entity';
import { AssignServiceDto } from './dto/assign-service.dto';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';

@Injectable()
export class UserServicesService {
  constructor(
    @InjectRepository(UserService)
    private readonly userServiceRepository: Repository<UserService>,
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
  ) {}

  /** Profesional y servicio deben ser del negocio (si no, 404). */
  private async validateUserAndService(
    userId: string,
    serviceId: string,
    tenantId: string,
  ): Promise<void> {
    await Promise.all([
      this.usersService.findTenantMember(userId, tenantId),
      this.servicesService.findOne(serviceId, tenantId),
    ]);
  }

  private async findUserService(
    userId: string,
    serviceId: string,
  ): Promise<UserService> {
    const userService = await this.userServiceRepository.findOne({
      where: { userId, serviceId },
    });

    if (!userService) {
      throw new NotFoundException('Service assignment not found');
    }

    return userService;
  }

  async assignService(
    userId: string,
    assignServiceDto: AssignServiceDto,
    tenantId: string,
  ): Promise<UserService> {
    await this.validateUserAndService(
      userId,
      assignServiceDto.serviceId,
      tenantId,
    );

    try {
      const existingAssignment = await this.findUserService(
        userId,
        assignServiceDto.serviceId,
      );

      // Actualizar asignación existente incluyendo commissionPercentage
      const updatedAssignment = this.userServiceRepository.create({
        ...existingAssignment,
        ...assignServiceDto,
        // Si no se proporciona, mantener el valor existente
        commissionPercentage:
          assignServiceDto.commissionPercentage !== undefined
            ? assignServiceDto.commissionPercentage
            : existingAssignment.commissionPercentage,
      });

      return await this.userServiceRepository.save(updatedAssignment);
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Crear nueva asignación
        const newUserService = this.userServiceRepository.create({
          userId,
          ...assignServiceDto,
          // Sin excepción (8.02): `null` = usa la comisión general del profesional.
          commissionPercentage: assignServiceDto.commissionPercentage ?? null,
        });

        return await this.userServiceRepository.save(newUserService);
      }
      throw error;
    }
  }

  async assignMultipleServices(
    userId: string,
    assignServicesDto: AssignServiceDto[],
    tenantId: string,
  ): Promise<UserService[]> {
    await this.usersService.findTenantMember(userId, tenantId);

    const result = [];
    for (const serviceDto of assignServicesDto) {
      const userService = await this.assignService(
        userId,
        serviceDto,
        tenantId,
      );
      result.push(userService);
    }

    return result;
  }

  /**
   * Servicios que puede atender quien llama (`GET /auth/me/services`):
   * - Employee: los suyos, asignados y activos (y el servicio activo), con el
   *   % de comisión efectivo (su excepción, o su general). Nunca los de otros.
   * - Owner: todos los servicios activos del negocio (los hace todos, 7.03).
   * `price` y `duration` son los del catálogo: es lo que cobra la cita
   * (`priceLinesFor`; `customPrice` no se usa en ningún cálculo).
   */
  async findMine(user: AuthUser): Promise<MyService[]> {
    const tenantId = tenantIdFrom(user);
    const shape = (service: Service, commission: string | null) => ({
      id: service.id,
      name: service.name,
      duration: service.duration,
      price: Number(service.price),
      color: service.color,
      category: service.category
        ? { id: service.category.id, name: service.category.name }
        : null,
      commission_percentage: commission === null ? null : Number(commission),
    });

    if (!isOnlyEmployee(user)) {
      const services = await this.userServiceRepository.manager
        .getRepository(Service)
        .find({
          where: { ownerId: tenantId, isActive: true },
          relations: { category: true },
          order: { name: 'ASC' },
        });
      return services.map((service) => shape(service, null));
    }

    const [assignments, me] = await Promise.all([
      this.userServiceRepository.find({
        where: {
          userId: user.id,
          isActive: true,
          service: { ownerId: tenantId, isActive: true },
        },
        relations: { service: { category: true } },
      }),
      this.userServiceRepository.manager.getRepository(User).findOne({
        where: { id: user.id },
        select: { id: true, commission_percentage: true },
      }),
    ]);
    return assignments
      .map((row) =>
        shape(
          row.service,
          effectiveCommission(
            row.commissionPercentage,
            me?.commission_percentage,
          ),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getUserServices(
    userId: string,
    tenantId: string,
  ): Promise<UserService[]> {
    await this.usersService.findTenantMember(userId, tenantId);

    return this.userServiceRepository.find({
      where: { userId },
      relations: ['service'],
    });
  }

  async removeService(
    userId: string,
    serviceId: string,
    tenantId: string,
  ): Promise<void> {
    await this.usersService.findTenantMember(userId, tenantId);
    const userService = await this.findUserService(userId, serviceId);
    await this.userServiceRepository.remove(userService);
  }
}

/** Un servicio de `GET /auth/me/services`. */
export interface MyService {
  id: string;
  name: string;
  duration: number;
  price: number;
  color: string;
  category: { id: string; name: string } | null;
  /** % de comisión efectivo del Employee en ese servicio; `null` para el Owner. */
  commission_percentage: number | null;
}
