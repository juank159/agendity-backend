// src/clients/clients.service.ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  async create(createClientDto: CreateClientDto): Promise<Client> {
    const existingClient = await this.clientRepository.findOne({
      where: [
        { email: createClientDto.email },
        { phone: createClientDto.phone }
      ]
    });

    if (existingClient) {
      const duplicatedField = existingClient.email === createClientDto.email ? 'email' : 'teléfono';
      const duplicatedValue = duplicatedField === 'email' ? createClientDto.email : createClientDto.phone;
      throw new ConflictException(`Ya existe un cliente con el ${duplicatedField}: ${duplicatedValue}`);
    }

    const client = this.clientRepository.create(createClientDto);
    return await this.clientRepository.save(client);
  }

  async findAll(): Promise<Client[]> {
    return await this.clientRepository.find({
      relations: ['appointments', 'reviews']
    });
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientRepository.findOne({
      where: { id },
      relations: ['appointments', 'reviews']
    });

    if (!client) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id);

    if (updateClientDto.email && updateClientDto.email !== client.email) {
      const existingEmail = await this.clientRepository.findOne({
        where: { email: updateClientDto.email }
      });
      if (existingEmail) {
        throw new ConflictException(`Ya existe un cliente con el email: ${updateClientDto.email}`);
      }
    }

    if (updateClientDto.phone && updateClientDto.phone !== client.phone) {
      const existingPhone = await this.clientRepository.findOne({
        where: { phone: updateClientDto.phone }
      });
      if (existingPhone) {
        throw new ConflictException(`Ya existe un cliente con el teléfono: ${updateClientDto.phone}`);
      }
    }

    Object.assign(client, updateClientDto);
    return await this.clientRepository.save(client);
  }

  async remove(id: string): Promise<void> {
    const client = await this.findOne(id);
    await this.clientRepository.remove(client);
  }
}