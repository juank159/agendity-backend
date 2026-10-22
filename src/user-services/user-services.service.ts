import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserService } from './entities/user-service.entity';
import { AssignServiceDto } from './dto/assign-service.dto';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';

@Injectable()
export class UserServicesService {
  constructor(
    @InjectRepository(UserService)
    private readonly userServiceRepository: Repository<UserService>,
    @Inject(forwardRef(() => UsersService))
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
          // Valor por defecto 0 si no se proporciona
          commissionPercentage: assignServiceDto.commissionPercentage || 0,
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
