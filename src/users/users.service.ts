import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User, omitUserSecrets } from './entities/user.entity';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';

import { FindUserQuery } from 'src/auth/interfaces';
import {
  UserAccessActor,
  assertCanManageUser,
  assertUserInTenant,
} from './user-access';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
  ) {}

  /** El actor y sus empleados (nunca usuarios de otro negocio). */
  async findAll(actor: UserAccessActor) {
    const users = await this.usersRepository.find({
      where: [{ id: actor.id }, { owner: { id: actor.id } }],
      relations: ['roles'],
    });
    return users.map((user) => {
      const dataUser = omitUserSecrets(user);
      return {
        ...dataUser,
        roles: dataUser.roles.map((role) => ({ name: role.name })),
      };
    });
  }

  async findOne(query: FindUserQuery): Promise<Omit<User, 'password'>> {
    this.validateQuery(query);

    try {
      const user = await this.usersRepository.findOne({
        where: { ...query },
        select: {
          id: true,
          name: true,
          lastname: true,
          email: true,
          image: true,
          phone: true,
          notification_token: true,
          created_at: true,
          updated_at: true,
        },
      });

      if (!user) {
        throw new NotFoundException(
          `Usuario con la consulta ${JSON.stringify(query)} no fue encontrado`,
        );
      }

      return user;
    } catch (error) {
      this.handleError(error);
    }
  }

  /** Un usuario (profesional) del negocio `tenantId`; si no, 404. */
  async findTenantMember(userId: string, tenantId: string): Promise<User> {
    return assertUserInTenant(this.usersRepository, tenantId, userId);
  }

  /** `GET /users/:param`: solo uno mismo o un empleado propio; si no, 404. */
  async findOneForActor(
    actor: UserAccessActor,
    query: FindUserQuery,
  ): Promise<Omit<User, 'password'>> {
    this.validateQuery(query);
    const target = await assertCanManageUser(
      this.usersRepository,
      actor,
      query,
    );
    return this.findOne({ id: target.id });
  }

  async update(
    actor: UserAccessActor,
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<Omit<User, 'password'>> {
    await assertCanManageUser(this.usersRepository, actor, { id });
    const user = await this.findOne({ id });

    const updatedUser = this.usersRepository.create({
      ...user,
      ...updateUserDto,
    });

    try {
      await this.usersRepository.save(updatedUser);
      return updatedUser;
    } catch (error) {
      this.handleDBErrors(error);
    }
  }

  private validateQuery(query: FindUserQuery): void {
    if (Object.keys(query).length === 0) {
      throw new BadRequestException(
        'At least one search parameter is required',
      );
    }

    if (query.id && !isUUID(query.id)) {
      throw new BadRequestException('Invalid UUID format for id');
    }

    if (query.email && !this.isValidEmail(query.email)) {
      throw new BadRequestException('Invalid email format');
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private handleError(error: any): never {
    if (error instanceof HttpException) {
      throw error;
    }

    throw new Error(`Error finding user: ${error.message}`);
  }

  private handleDBErrors(error: any): never {
    if (error.code === '23505') throw new BadRequestException(error.detail);
    throw new InternalServerErrorException('Please check server logs');
  }

  async updateUserImage(
    actor: UserAccessActor,
    userId: string,
    imageUrl: string,
  ): Promise<User> {
    try {
      await assertCanManageUser(this.usersRepository, actor, { id: userId });
      const user = await this.findOne({ id: userId });

      if (!user) {
        throw new NotFoundException(`Usuario con ID ${userId} no encontrado`);
      }

      const updatedUser = await this.usersRepository.save({
        ...user,
        image: imageUrl,
      });

      // Omitimos el password en la respuesta
      const userWithoutPassword = omitUserSecrets(updatedUser);
      return userWithoutPassword as User;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error al actualizar la imagen del usuario: ${error.message}`,
      );
    }
  }
}
