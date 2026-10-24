import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { RELATION_GROUPS } from './constants/relations.constants';
import { ClientFindOptions } from './interfaces/client-find-options.interface';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { PaginationDto, PaginationResult } from './dto/pagination.dto';
import { parseBusinessDate } from '../common/utils/date.util';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  /**
   * Las `HttpException` y los errores de BD (`QueryFailedError`) salen tal cual
   * al filtro global, que los traduce (22P02 → 400, 23505 → 409 con
   * `DUPLICATE_PHONE`/`DUPLICATE_EMAIL`, 23503 → 409). Antes se envolvían en un
   * 500 (`GET /clients/no-uuid`). El resto → 500 sin detalles internos.
   */
  private handleError(error: any, options: ErrorHandlerOptions): never {
    if (error instanceof HttpException || error instanceof QueryFailedError) {
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

  private async findClient(options: ClientFindOptions): Promise<Client> {
    const { id, email, phone, ownerId, loadRelations = true } = options;

    try {
      const queryBuilder = this.clientRepository
        .createQueryBuilder('client')
        .where('client.ownerId = :ownerId', { ownerId });

      if (loadRelations) {
        RELATION_GROUPS.default.forEach((relation) => {
          queryBuilder.leftJoinAndSelect(`client.${relation}`, relation);
        });
      }

      if (id) queryBuilder.andWhere('client.id = :id', { id });
      if (email) queryBuilder.andWhere('client.email = :email', { email });
      if (phone) queryBuilder.andWhere('client.phone = :phone', { phone });

      const client = await queryBuilder.getOne();

      if (!client && id) {
        throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
      }

      return client;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'buscar',
      });
    }
  }

  private async validateUniqueFields(
    dto: CreateClientDto | UpdateClientDto,
    ownerId: string,
    currentId?: string,
  ): Promise<void> {
    const whereConditions = [];

    if ('email' in dto && dto.email) {
      whereConditions.push({ email: dto.email, ownerId });
    }

    if ('phone' in dto && dto.phone) {
      whereConditions.push({ phone: dto.phone, ownerId });
    }

    if (whereConditions.length === 0) return;

    // Buscar si existe un cliente con el mismo email o teléfono para este tenant
    const existingClients = await this.clientRepository.find({
      where: whereConditions,
    });

    const existingClient = existingClients.find(
      (client) => client.id !== currentId,
    );

    if (existingClient) {
      const duplicatedField =
        existingClient.email === dto.email ? 'email' : 'teléfono';
      const duplicatedValue =
        duplicatedField === 'email' ? dto.email : dto.phone;
      throw new ConflictException(
        `Ya existe un cliente con el ${duplicatedField}: ${duplicatedValue}`,
      );
    }
  }

  async create(
    createClientDto: CreateClientDto,
    tenantId: string,
  ): Promise<Client> {
    try {
      await this.validateUniqueFields(createClientDto, tenantId);

      const client = this.clientRepository.create({
        ...createClientDto,
        ownerId: tenantId,
        showNotes: createClientDto.showNotes ?? false, // Valor por defecto para nuevos campos
        notes: createClientDto.notes ?? null,
        birthday: createClientDto.birthday
          ? parseBusinessDate(createClientDto.birthday)
          : null,
        isFromDevice: false,
        isActive: true,
      } as Client);

      return await this.clientRepository.save(client);
    } catch (error) {
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'crear',
      });
    }
  }

  async findAll(
    tenantId: string,
    paginationDto?: PaginationDto,
  ): Promise<PaginationResult<Client>> {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        sortBy = 'created_at',
        sortOrder = 'DESC',
        status = 'all',
        source = 'all',
      } = paginationDto || {};

      console.log('📊 Paginación solicitada:', {
        page,
        limit,
        search,
        sortBy,
        sortOrder,
        status,
        source,
        tenantId,
      });

      const skip = (page - 1) * limit;

      // Construcción dinámica de la consulta
      const queryBuilder = this.clientRepository
        .createQueryBuilder('client')
        .where('client.ownerId = :ownerId', { ownerId: tenantId });

      // ✅ FILTRO DE BÚSQUEDA
      if (search) {
        const searchTerm = `%${search.toLowerCase()}%`;
        queryBuilder.andWhere(
          '(LOWER(client.name) LIKE :search OR LOWER(client.lastname) LIKE :search OR LOWER(client.email) LIKE :search OR client.phone LIKE :search)',
          { search: searchTerm },
        );
      }

      // ✅ FILTRO POR ESTADO
      if (status !== 'all') {
        queryBuilder.andWhere('client.isActive = :isActive', {
          isActive: status === 'active',
        });
      }

      // ✅ FILTRO POR ORIGEN
      if (source !== 'all') {
        queryBuilder.andWhere('client.isFromDevice = :isFromDevice', {
          isFromDevice: source === 'imported',
        });
      }

      // ✅ ORDENAMIENTO DINÁMICO
      const validSortFields = [
        'name',
        'lastname',
        'email',
        'phone',
        'created_at',
      ];
      const finalSortBy = validSortFields.includes(sortBy)
        ? sortBy
        : 'created_at';
      queryBuilder.orderBy(`client.${finalSortBy}`, sortOrder);

      // ✅ PAGINACIÓN
      queryBuilder.skip(skip).take(limit);

      // ✅ CARGAR SOLO RELACIONES MÍNIMAS PARA LISTADO (OPTIMIZACIÓN)
      // No cargar appointments y reviews por defecto para mejorar performance
      // queryBuilder.leftJoinAndSelect('client.appointments', 'appointments');
      // queryBuilder.leftJoinAndSelect('client.reviews', 'reviews');

      // ✅ EJECUTAR CONSULTA CON COUNT
      const [data, total] = await queryBuilder.getManyAndCount();

      // ✅ CALCULAR METADATOS DE PAGINACIÓN
      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      console.log('📈 Resultado de paginación:', {
        total,
        returned: data.length,
        page,
        totalPages,
        hasNextPage,
        hasPrevPage,
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
      };
    } catch (error) {
      console.error('❌ Error en findAll paginado:', error);
      this.handleError(error, {
        entity: 'los clientes',
        operation: 'listar',
      });
    }
  }

  // ✅ MANTENER MÉTODO LEGACY PARA RETROCOMPATIBILIDAD
  async findAllLegacy(tenantId: string): Promise<Client[]> {
    try {
      return await this.clientRepository.find({
        where: { ownerId: tenantId },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los clientes',
        operation: 'listar',
      });
    }
  }

  async findOne(id: string, tenantId: string): Promise<Client> {
    return await this.findClient({ id, ownerId: tenantId });
  }

  /**
   * Importación masiva desde los contactos del teléfono. Contrato PARCIAL (la
   * app lo lee así): se importan las filas válidas y cada fila rechazada va en
   * `errors` con su motivo.
   *
   * 2.17: cada fila corre en su propio SAVEPOINT (`manager.transaction`
   * anidado = `SAVEPOINT typeorm_N` en TypeORM 0.3). Antes, un error de BD en
   * una fila (unique por una alta simultánea, dato demasiado largo…) se
   * capturaba dentro de la transacción ya abortada: las filas siguientes
   * fallaban con "current transaction is aborted" y el COMMIT final hacía
   * ROLLBACK de todo, aunque la respuesta decía que se habían importado.
   * Con el savepoint solo se deshace esa fila. Un error que no es de la fila
   * (conexión, etc.) sale de la transacción y no importa nada.
   */
  async importBatch(createClientDtos: CreateClientDto[], tenantId: string) {
    try {
      const results: Client[] = [];
      const errors: Array<{ data: CreateClientDto; error: string }> = [];

      await this.clientRepository.manager.transaction(async (manager) => {
        for (const dto of createClientDtos) {
          try {
            const saved = await manager.transaction((rowManager) =>
              this.importRow(rowManager, dto, tenantId),
            );
            if (saved) {
              results.push(saved);
            } else {
              errors.push({
                data: dto,
                error: `Cliente con teléfono ${dto.phone} ya existe`,
              });
            }
          } catch (error) {
            if (!(error instanceof QueryFailedError)) throw error;
            errors.push({ data: dto, error: this.importRowError(error, dto) });
          }
        }
      });

      this.logger.log(
        `Importación de clientes: ${results.length} de ${createClientDtos.length} (rechazados ${errors.length})`,
      );
      return {
        imported: results,
        errors,
        success: results.length,
        failed: errors.length,
        total: createClientDtos.length,
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los clientes',
        operation: 'batch',
        detail: 'importación masiva',
      });
    }
  }

  /** Una fila del import; `null` si el teléfono ya existe en el negocio. */
  private async importRow(
    manager: EntityManager,
    dto: CreateClientDto,
    tenantId: string,
  ): Promise<Client | null> {
    const existing = await manager.findOne(Client, {
      where: { phone: dto.phone, ownerId: tenantId },
    });
    if (existing) return null;

    const client = manager.create(Client, {
      ...dto,
      ownerId: tenantId,
      isFromDevice: true,
      showNotes: dto.showNotes ?? false,
      notes: dto.notes ?? null,
      birthday: dto.birthday ? parseBusinessDate(dto.birthday) : null,
      isActive: true,
    });
    return manager.save(Client, client);
  }

  /** Motivo apto para el usuario (sin el texto interno de Postgres). */
  private importRowError(
    error: QueryFailedError,
    dto: CreateClientDto,
  ): string {
    const code = (
      error as QueryFailedError & { driverError?: { code?: string } }
    ).driverError?.code;
    if (code === '23505') {
      return `Cliente con teléfono ${dto.phone} ya existe`;
    }
    this.logger.warn(`Fila de importación rechazada por la BD (${code})`);
    return 'No se pudo importar este cliente';
  }

  async updateClientImage(
    clientId: string,
    imageUrl: string,
    tenantId: string,
  ): Promise<Client> {
    try {
      // Ahora pasamos ambos parámetros requeridos
      const client = await this.findOne(clientId, tenantId);

      if (!client) {
        throw new NotFoundException(`Cliente con ID ${clientId} no encontrado`);
      }

      // Actualizamos solo la imagen
      const updatedClient = await this.clientRepository.save({
        ...client,
        image: imageUrl,
      });

      return updatedClient;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error al actualizar la imagen del cliente: ${error.message}`,
      );
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const client = await this.findClient({ id, ownerId: tenantId });
      await this.clientRepository.remove(client);
    } catch (error) {
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'eliminar',
      });
    }
  }

  async update(
    id: string,
    updateClientDto: UpdateClientDto,
    tenantId: string,
  ): Promise<Client> {
    try {
      const currentClient = await this.findClient({ id, ownerId: tenantId });
      // Unicidad dentro del negocio, excluyendo al propio cliente
      await this.validateUniqueFields(updateClientDto, tenantId, id);

      const updatedClient = this.clientRepository.create({
        ...currentClient,
        ...updateClientDto,
        // Fecha sin offset = día del negocio (nunca una cadena directa a Postgres)
        ...(updateClientDto.birthday
          ? { birthday: parseBusinessDate(updateClientDto.birthday) }
          : {}),
        // Asegurarse de que la imagen se actualice
        image: updateClientDto.image || currentClient.image,
      });

      return await this.clientRepository.save(updatedClient);
    } catch (error) {
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'actualizar',
      });
    }
  }
}
