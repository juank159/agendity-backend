import { Injectable, NotFoundException } from '@nestjs/common';
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
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
  ) {}

  private async validateUserAndService(
    userId: string,
    serviceId: string,
  ): Promise<void> {
    await Promise.all([
      this.usersService.findOne({ id: userId }),
      this.servicesService.findOne(serviceId, userId),
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
  ): Promise<UserService> {
    await this.validateUserAndService(userId, assignServiceDto.serviceId);

    try {
      const existingAssignment = await this.findUserService(
        userId,
        assignServiceDto.serviceId,
      );

      const updatedAssignment = this.userServiceRepository.create({
        ...existingAssignment,
        ...assignServiceDto,
      });

      return await this.userServiceRepository.save(updatedAssignment);
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Crear nueva asignación
        const newUserService = this.userServiceRepository.create({
          userId,
          ...assignServiceDto,
        });

        return await this.userServiceRepository.save(newUserService);
      }
      throw error;
    }
  }

  async getUserServices(userId: string): Promise<UserService[]> {
    await this.usersService.findOne({ id: userId });

    return this.userServiceRepository.find({
      where: { userId },
      relations: ['service'],
    });
  }

  async removeService(userId: string, serviceId: string): Promise<void> {
    const userService = await this.findUserService(userId, serviceId);
    await this.userServiceRepository.remove(userService);
  }
}
