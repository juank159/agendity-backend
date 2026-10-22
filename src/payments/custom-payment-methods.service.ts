// src/payments/custom-payment-methods.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomPaymentMethod } from './entities/custom-payment-method.entity';
import { CreateCustomPaymentMethodDto } from './dto/create-custom-payment-method.dto';
import { UpdateCustomPaymentMethodDto } from './dto/update-custom-payment-method.dto';

@Injectable()
export class CustomPaymentMethodsService {
  constructor(
    @InjectRepository(CustomPaymentMethod)
    private readonly customPaymentMethodRepository: Repository<CustomPaymentMethod>,
  ) {}

  async create(
    createDto: CreateCustomPaymentMethodDto,
    tenantId: string,
  ): Promise<CustomPaymentMethod> {
    // Verificar si ya existe un método con el mismo nombre para este usuario
    const existingMethod = await this.customPaymentMethodRepository.findOne({
      where: {
        name: createDto.name,
        ownerId: tenantId,
      },
    });

    if (existingMethod) {
      throw new ConflictException(
        `Ya existe un método de pago con el nombre "${createDto.name}"`,
      );
    }

    const customPaymentMethod = this.customPaymentMethodRepository.create({
      ...createDto,
      ownerId: tenantId,
    });

    return this.customPaymentMethodRepository.save(customPaymentMethod);
  }

  async findAll(tenantId: string): Promise<CustomPaymentMethod[]> {
    return this.customPaymentMethodRepository.find({
      where: { ownerId: tenantId },
      order: { name: 'ASC' },
    });
  }

  async findAllActive(tenantId: string): Promise<CustomPaymentMethod[]> {
    return this.customPaymentMethodRepository.find({
      where: { ownerId: tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<CustomPaymentMethod> {
    const customPaymentMethod =
      await this.customPaymentMethodRepository.findOne({
        where: { id, ownerId: tenantId },
      });

    if (!customPaymentMethod) {
      throw new NotFoundException(`Método de pago con ID ${id} no encontrado`);
    }

    return customPaymentMethod;
  }

  async update(
    id: string,
    updateDto: UpdateCustomPaymentMethodDto,
    tenantId: string,
  ): Promise<CustomPaymentMethod> {
    const customPaymentMethod = await this.findOne(id, tenantId);

    // Si se está actualizando el nombre, verificar que no haya conflictos
    if (updateDto.name && updateDto.name !== customPaymentMethod.name) {
      const existingMethod = await this.customPaymentMethodRepository.findOne({
        where: {
          name: updateDto.name,
          ownerId: tenantId,
        },
      });

      if (existingMethod) {
        throw new ConflictException(
          `Ya existe un método de pago con el nombre "${updateDto.name}"`,
        );
      }
    }

    // Actualizar y guardar
    Object.assign(customPaymentMethod, updateDto);
    return this.customPaymentMethodRepository.save(customPaymentMethod);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const customPaymentMethod = await this.findOne(id, tenantId);
    await this.customPaymentMethodRepository.remove(customPaymentMethod);
  }
}
