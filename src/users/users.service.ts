import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto, UpdateUserDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';

import { FindUserQuery } from 'src/auth/interfaces';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
  ) {}

  async findAll() {
    const users = await this.usersRepository.find({ relations: ['roles'] });
    return users.map((user) => {
      const { password, ...dataUser } = user;
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

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<Omit<User, 'password'>> {
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

  async remove(id: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Usuario con id ${id} no fue encontrado`);
    }
    await this.usersRepository.remove(user);
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
    if (
      error instanceof NotFoundException ||
      error instanceof BadRequestException
    ) {
      throw error;
    }

    throw new Error(`Error finding user: ${error.message}`);
  }

  private handleDBErrors(error: any): never {
    if (error.code === '23505') throw new BadRequestException(error.detail);
    throw new InternalServerErrorException('Please check server logs');
  }

  async updateUserImage(userId: string, imageUrl: string): Promise<User> {
    const user = await this.findOne({ id: userId });
    user.image = imageUrl;
    return this.usersRepository.save(user);
  }
}
