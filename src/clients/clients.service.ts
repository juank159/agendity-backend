import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  Patch,
  UseInterceptors,
  Param,
  UploadedFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { RELATION_GROUPS } from './constants/relations.constants';
import { ClientFindOptions } from './interfaces/client-find-options.interface';
import { FileInterceptor } from '@nestjs/platform-express';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);
    console.error('Stack trace:', error.stack);

    if (error instanceof HttpException) {
      throw error;
    }

    if (error?.code === '23505') {
      const match = error.detail.match(/Key \((.*?)\)=/);
      const field = match ? match[1] : 'campo';
      throw new ConflictException(
        `Ya existe ${options.entity} con el mismo ${field}`,
      );
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. ${
        options.detail ? `Detalle: ${options.detail}. ` : ''
      }Por favor, intenta nuevamente.`,
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
    currentId?: string,
  ): Promise<void> {
    const conditions = [];

    if ('email' in dto) {
      conditions.push({ email: dto.email });
    }

    if ('phone' in dto) {
      conditions.push({ phone: dto.phone });
    }

    const existingClient = await this.clientRepository.findOne({
      where: conditions,
    });

    if (existingClient && existingClient.id !== currentId) {
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
    userId: string,
  ): Promise<Client> {
    try {
      await this.validateUniqueFields(createClientDto);

      const client = this.clientRepository.create({
        ...createClientDto,
        ownerId: userId,
        showNotes: createClientDto.showNotes ?? false, // Valor por defecto para nuevos campos
        notes: createClientDto.notes ?? null,
        birthday: createClientDto.birthday
          ? new Date(createClientDto.birthday)
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

  async findAll(userId: string): Promise<Client[]> {
    try {
      return await this.clientRepository.find({
        where: { ownerId: userId },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los clientes',
        operation: 'listar',
      });
    }
  }

  async findOne(id: string, userId: string): Promise<Client> {
    return await this.findClient({ id, ownerId: userId });
  }

  async importBatch(createClientDtos: CreateClientDto[], userId: string) {
    try {
      console.log('Iniciando importación:', {
        totalClients: createClientDtos.length,
        userId,
      });

      const results: Client[] = [];
      const errors: Array<{ data: CreateClientDto; error: string }> = [];

      await this.clientRepository.manager.transaction(
        async (transactionalEntityManager) => {
          for (const dto of createClientDtos) {
            try {
              const existingClient = await transactionalEntityManager.findOne(
                Client,
                {
                  where: {
                    phone: dto.phone,
                    ownerId: userId,
                  },
                },
              );

              if (existingClient) {
                console.log('Cliente existente:', existingClient);
                errors.push({
                  data: dto,
                  error: `Cliente con teléfono ${dto.phone} ya existe`,
                });
                continue;
              }

              const client = transactionalEntityManager.create(Client, {
                ...dto,
                ownerId: userId,
                isFromDevice: true,
                showNotes: dto.showNotes ?? false,
                notes: dto.notes ?? null,
                birthday: dto.birthday ? new Date(dto.birthday) : null,
                isActive: true,
              });

              const savedClient = await transactionalEntityManager.save(
                Client,
                client,
              );
              console.log('Cliente guardado:', savedClient);
              results.push(savedClient);
            } catch (error) {
              console.error('Error procesando cliente:', dto, error);
              errors.push({
                data: dto,
                error: error.message || 'Error desconocido',
              });
            }
          }

          console.log('Resumen:', {
            total: createClientDtos.length,
            success: results.length,
            failed: errors.length,
          });
        },
      );

      return {
        imported: results,
        errors,
        success: results.length,
        failed: errors.length,
        total: createClientDtos.length,
      };
    } catch (error) {
      console.error('Error en transacción:', error);
      this.handleError(error, {
        entity: 'los clientes',
        operation: 'batch',
        detail: 'importación masiva',
      });
    }
  }
  async updateClientImage(
    clientId: string,
    imageUrl: string,
    userId: string,
  ): Promise<Client> {
    try {
      // Ahora pasamos ambos parámetros requeridos
      const client = await this.findOne(clientId, userId);

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

  async remove(id: string, userId: string): Promise<void> {
    try {
      const client = await this.findClient({ id, ownerId: userId });
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
    userId: string,
  ): Promise<Client> {
    try {
      console.log('Updating client with data:', {
        id,
        updateClientDto,
        userId,
      });
      const currentClient = await this.findClient({ id, ownerId: userId });
      await this.validateUniqueFields(updateClientDto, id);

      const updatedClient = this.clientRepository.create({
        ...currentClient,
        ...updateClientDto,
        // Asegurarse de que la imagen se actualice
        image: updateClientDto.image || currentClient.image,
      });

      console.log('Final update object:', updatedClient);
      return await this.clientRepository.save(updatedClient);
    } catch (error) {
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'actualizar',
      });
    }
  }
}
