import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { RELATION_GROUPS } from './constants/relations.constants';
import { ClientFindOptions } from './interfaces/client-find-options.interface';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    if (error?.code === '23505') {
      throw new ConflictException(
        `Ya existe ${options.entity} con ${options.detail}`,
      );
    }

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

  async update(
    id: string,
    updateClientDto: UpdateClientDto,
    userId: string,
  ): Promise<Client> {
    try {
      const currentClient = await this.findClient({ id, ownerId: userId });
      await this.validateUniqueFields(updateClientDto, id);

      const updatedClient = this.clientRepository.create({
        ...currentClient,
        ...updateClientDto,
      });

      return await this.clientRepository.save(updatedClient);
    } catch (error) {
      this.handleError(error, {
        entity: 'el cliente',
        operation: 'actualizar',
      });
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
}
