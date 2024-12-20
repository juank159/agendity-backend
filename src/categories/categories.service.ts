import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Category } from './entities/category.entity';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';

import { FindOptionsCategory } from './interfaces/find-options.interface';
import { ErrorHandlerOptions } from 'src/common/interfaces';

@Injectable()
export class CategoriesService {
  private readonly DEFAULT_RELATIONS = ['services'];
  private readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof BadRequestException
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

  private async validateUser(userId: string): Promise<User> {
    try {
      if (!userId) {
        throw new BadRequestException('Se requiere el ID del usuario');
      }

      const user = await this.userRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      return user;
    } catch (error) {
      this.handleError(error, {
        entity: 'el usuario',
        operation: 'validar',
      });
    }
  }

  private async findCategory(options: FindOptionsCategory): Promise<Category> {
    const { id, name, ownerId, loadRelations = true } = options;

    try {
      const queryBuilder = this.categoryRepository
        .createQueryBuilder('category')
        .where('category.ownerId = :ownerId', { ownerId });

      if (loadRelations) {
        queryBuilder.leftJoinAndSelect('category.services', 'services');
      }

      if (id) {
        queryBuilder.andWhere('category.id = :id', { id });
      }

      if (name) {
        queryBuilder.andWhere('LOWER(category.name) = LOWER(:name)', { name });
      }

      const category = await queryBuilder.getOne();

      if (!category) {
        const searchTerm = id ? `ID ${id}` : `nombre "${name}"`;
        throw new NotFoundException(
          `No se encontró ninguna categoría con ${searchTerm} en tu negocio`,
        );
      }

      return category;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'buscar',
      });
    }
  }

  private async checkDuplicateCategory(
    name: string,
    userId: string,
    excludeId?: string,
  ): Promise<void> {
    const whereConditions: any = {
      name,
      ownerId: userId,
    };

    if (excludeId) {
      whereConditions.id = Not(excludeId);
    }

    const existingCategory = await this.categoryRepository.findOne({
      where: whereConditions,
    });

    if (existingCategory) {
      throw new ConflictException(
        `Ya tienes una categoría con el nombre '${name}'. Por favor, usa un nombre diferente.`,
      );
    }
  }

  async create(
    createCategoryDto: CreateCategoryDto,
    userId: string,
  ): Promise<Category> {
    await this.validateUser(userId);

    try {
      await this.checkDuplicateCategory(createCategoryDto.name, userId);

      const newCategory = this.categoryRepository.create({
        ...createCategoryDto,
        ownerId: userId,
      });

      return await this.categoryRepository.save(newCategory);
    } catch (error) {
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'crear',
        detail: `el nombre '${createCategoryDto.name}'`,
      });
    }
  }

  async findAll(userId: string): Promise<Category[]> {
    try {
      await this.validateUser(userId);

      return await this.categoryRepository.find({
        where: { ownerId: userId },
        relations: ['services'],
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las categorías',
        operation: 'listar',
      });
    }
  }

  async findOne(term: string, userId: string): Promise<Category> {
    const isUUID = this.UUID_REGEX.test(term);

    return await this.findCategory({
      ...(isUUID ? { id: term } : { name: term }),
      ownerId: userId,
    });
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    userId: string,
  ): Promise<Category> {
    try {
      const currentCategory = await this.findCategory({ id, ownerId: userId });

      if (updateCategoryDto.name) {
        await this.checkDuplicateCategory(updateCategoryDto.name, userId, id);
      }

      const updatedCategory = this.categoryRepository.create({
        ...currentCategory,
        ...updateCategoryDto,
      });

      return await this.categoryRepository.save(updatedCategory);
    } catch (error) {
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    try {
      const category = await this.findCategory({ id, ownerId: userId });
      await this.categoryRepository.remove(category);
    } catch (error) {
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'eliminar',
      });
    }
  }
}
