import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CategoriesService } from '../categories/categories.service';
import { ServiceFindOptions } from './interfaces/service-find-options.interface';
import { ErrorHandlerServiceOptions } from './interfaces/error-handler-service.interface';
import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @Inject(forwardRef(() => CategoriesService)) // Usar forwardRef aquí
    private readonly categoriesService: CategoriesService,
  ) {}

  private handleError(error: any, options: ErrorHandlerServiceOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  private async findService(options: ServiceFindOptions): Promise<Service> {
    const { id, name, ownerId, categoryId, loadRelations = true } = options;

    try {
      const queryBuilder = this.serviceRepository
        .createQueryBuilder('service')
        .where('service.ownerId = :ownerId', { ownerId });

      if (loadRelations) {
        queryBuilder.leftJoinAndSelect(
          `service.${RELATIONS.CATEGORY}`,
          RELATIONS.CATEGORY,
        );
      }

      if (id) queryBuilder.andWhere('service.id = :id', { id });
      if (name)
        queryBuilder.andWhere('LOWER(service.name) = LOWER(:name)', { name });
      if (categoryId)
        queryBuilder.andWhere('service.categoryId = :categoryId', {
          categoryId,
        });

      const service = await queryBuilder.getOne();

      if (!service) {
        const searchTerm = id ? `ID ${id}` : `nombre "${name}"`;
        throw new NotFoundException(
          `No se encontró ningún servicio con ${searchTerm} en tu negocio`,
        );
      }

      return service;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.handleError(error, {
        entity: 'el servicio',
        operation: 'buscar',
      });
    }
  }

  async create(
    createServiceDto: CreateServiceDto,
    tenantId: string,
  ): Promise<Service> {
    try {
      // Verificar si ya existe un servicio con el mismo nombre y propietario
      const existingService = await this.findService({
        name: createServiceDto.name,
        ownerId: tenantId,
        loadRelations: false,
      }).catch((error) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });

      if (existingService) {
        throw new ConflictException(
          `Ya existe un servicio con el nombre '${createServiceDto.name}'`,
        );
      }

      // Validar que la categoría exista
      await this.categoriesService.findOne(
        createServiceDto.categoryId,
        tenantId,
      );

      // Crear el servicio con valores predeterminados para los campos opcionales
      const service = this.serviceRepository.create({
        ...createServiceDto,
        ownerId: tenantId,
        color: createServiceDto.color || '#1c94f4',
        priceType: createServiceDto.priceType || 'Precio fijo',
        onlineBooking: createServiceDto.onlineBooking ?? true,
        deposit: createServiceDto.deposit ?? 0,
        image: createServiceDto.image || null,
      });

      return await this.serviceRepository.save(service);
    } catch (error) {
      // Manejo de errores con detalle específico
      this.handleError(error, {
        entity: 'el servicio',
        operation: 'crear',
        detail: `el nombre '${createServiceDto.name}'`,
      });
    }
  }

  async findAll(tenantId: string): Promise<Service[]> {
    try {
      return await this.serviceRepository.find({
        where: { ownerId: tenantId, isActive: true },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los servicios',
        operation: 'listar',
      });
    }
  }

  async findOne(id: string, tenantId: string): Promise<Service> {
    return await this.findService({ id, ownerId: tenantId });
  }

  async findByCategory(
    categoryId: string,
    tenantId: string,
  ): Promise<Service[]> {
    try {
      await this.categoriesService.findOne(categoryId, tenantId);

      return await this.serviceRepository.find({
        where: { categoryId, ownerId: tenantId },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los servicios',
        operation: 'buscar',
      });
    }
  }

  async update(
    id: string,
    updateServiceDto: UpdateServiceDto,
    tenantId: string,
  ): Promise<Service> {
    try {
      let currentService = await this.findService({ id, ownerId: tenantId });

      if (updateServiceDto.categoryId) {
        const category = await this.categoriesService.findOne(
          updateServiceDto.categoryId,
          tenantId,
        );

        currentService = {
          ...currentService,
          ...updateServiceDto,
          category, // Incluir la nueva categoría en la respuesta
        };
      }

      return await this.serviceRepository.save(currentService);
    } catch (error) {
      this.handleError(error, {
        entity: 'el servicio',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const service = await this.findService({ id, ownerId: tenantId });
      await this.serviceRepository.remove(service);
    } catch (error) {
      this.handleError(error, {
        entity: 'el servicio',
        operation: 'eliminar',
      });
    }
  }
}
