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

  private async validateUser(tenantId: string): Promise<User> {
    try {
      if (!tenantId) {
        throw new BadRequestException('Se requiere el ID del usuario');
      }

      const user = await this.userRepository.findOne({
        where: { id: tenantId },
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
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const whereConditions: any = {
      name,
      ownerId: tenantId,
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
    tenantId: string,
  ): Promise<Category> {
    await this.validateUser(tenantId);

    try {
      await this.checkDuplicateCategory(createCategoryDto.name, tenantId);

      const newCategory = this.categoryRepository.create({
        ...createCategoryDto,
        ownerId: tenantId,
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

  async findAll(tenantId: string): Promise<Category[]> {
    try {
      await this.validateUser(tenantId);

      return await this.categoryRepository.find({
        where: { ownerId: tenantId },
        relations: ['services'],
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las categorías',
        operation: 'listar',
      });
    }
  }

  async findOne(term: string, tenantId: string): Promise<Category> {
    const isUUID = this.UUID_REGEX.test(term);

    return await this.findCategory({
      ...(isUUID ? { id: term } : { name: term }),
      ownerId: tenantId,
    });
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    tenantId: string,
  ): Promise<Category> {
    try {
      const currentCategory = await this.findCategory({
        id,
        ownerId: tenantId,
      });

      if (updateCategoryDto.name) {
        await this.checkDuplicateCategory(updateCategoryDto.name, tenantId, id);
      }

      const updatedCategory = this.categoryRepository.create({
        ...currentCategory,
        ...updateCategoryDto,
        ownerId: currentCategory.ownerId, // nunca cambia de negocio
      });

      return await this.categoryRepository.save(updatedCategory);
    } catch (error) {
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const category = await this.findCategory({ id, ownerId: tenantId });
      await this.categoryRepository.remove(category);
    } catch (error) {
      this.handleError(error, {
        entity: 'la categoría',
        operation: 'eliminar',
      });
    }
  }
}
