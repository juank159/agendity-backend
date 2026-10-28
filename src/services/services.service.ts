import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CategoriesService } from '../categories/categories.service';
import { ServiceFindOptions } from './interfaces/service-find-options.interface';
import { ErrorHandlerServiceOptions } from './interfaces/error-handler-service.interface';
import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';

const SERVICE_NAME_TAKEN = 'Ya existe un servicio con ese nombre en tu negocio';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * `HttpException` (incluidas las `BusinessException`) y errores de BD salen
   * al filtro global. Un 23505 de `(owner_id, name)` (dos altas simultáneas con
   * el mismo nombre) se traduce al mismo 409 que la comprobación previa.
   */
  private handleError(error: any, options: ErrorHandlerServiceOptions): never {
    if (error instanceof HttpException) {
      throw error;
    }
    if (error instanceof QueryFailedError) {
      if ((error as QueryFailedError & { code?: string }).code === '23505') {
        throw new ConflictException(SERVICE_NAME_TAKEN);
      }
      throw error;
    }

    this.logger.error(
      `Error al ${options.operation} ${options.entity}: ${error?.message}`,
      error?.stack,
    );
    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  /**
   * Nombre único por negocio y sin distinguir mayúsculas (índice único
   * `(owner_id, name)` desde 2.08; antes era único en TODA la app). Si
   * `excludeId` viene, es el propio servicio (renombrar a sí mismo no choca).
   */
  private async assertNameAvailable(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const query = this.serviceRepository
      .createQueryBuilder('service')
      .where('service.ownerId = :tenantId', { tenantId })
      .andWhere('LOWER(service.name) = LOWER(:name)', { name });
    if (excludeId) query.andWhere('service.id <> :excludeId', { excludeId });
    if (await query.getExists()) {
      throw new ConflictException(SERVICE_NAME_TAKEN);
    }
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
      await this.assertNameAvailable(createServiceDto.name, tenantId);

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
      const currentService = await this.findService({ id, ownerId: tenantId });

      if (updateServiceDto.name !== undefined) {
        await this.assertNameAvailable(updateServiceDto.name, tenantId, id);
      }

      // Antes los cambios solo se aplicaban si venía `categoryId` (2.08).
      const changes: Partial<Service> = { ...updateServiceDto };
      if (updateServiceDto.categoryId) {
        // La nueva categoría debe ser del negocio (si no, 404).
        changes.category = await this.categoriesService.findOne(
          updateServiceDto.categoryId,
          tenantId,
        );
      }

      Object.assign(currentService, changes);
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
