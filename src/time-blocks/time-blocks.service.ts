import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { TimeBlock } from './entities/time-block.entity';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { UpdateTimeBlockDto } from './dto/update-time-block.dto';
import { UsersService } from '../users/users.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { User } from '../users/entities/user.entity';

import {
  TIME_BLOCK_RELATIONS,
  ERROR_MESSAGES,
} from './constants/time-block.constants';
import { TimeBlockResponseDto } from './dto/time-block.response.dto';

interface FindUserOptions {
  id: string;
}

@Injectable()
export class TimeBlocksService {
  constructor(
    @InjectRepository(TimeBlock)
    private readonly timeBlockRepository: Repository<TimeBlock>,
    private readonly usersService: UsersService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  private async getTimeBlockEntity(
    id: string,
    userId: string,
  ): Promise<TimeBlock> {
    const timeBlock = await this.timeBlockRepository.findOne({
      where: {
        id,
        user: { id: userId }, // Añadido filtro por userId para multitenant
      },
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
    });

    if (!timeBlock) {
      throw new NotFoundException(ERROR_MESSAGES.NOT_FOUND(id));
    }

    return timeBlock;
  }

  private async checkTimeBlockAvailability(
    professionalId: string,
    startDatetime: Date,
    endDatetime: Date,
    excludeBlockId?: string,
    userId?: string,
  ): Promise<boolean> {
    const queryBuilder = this.timeBlockRepository
      .createQueryBuilder('time_block')
      .where('time_block.user.id = :professionalId', { professionalId })
      .andWhere(
        '(time_block.start_datetime, time_block.end_datetime) OVERLAPS (:startDatetime, :endDatetime)',
        { startDatetime, endDatetime },
      );

    if (excludeBlockId) {
      queryBuilder.andWhere('time_block.id != :excludeBlockId', {
        excludeBlockId,
      });
    }

    if (userId) {
      queryBuilder.andWhere('time_block.user.id = :userId', { userId });
    }

    const overlappingBlock = await queryBuilder.getOne();
    return !overlappingBlock;
  }

  async findAll(userId: string): Promise<TimeBlockResponseDto[]> {
    const timeBlocks = await this.timeBlockRepository.find({
      where: { user: { id: userId } }, // Filtro por userId para multitenant
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
    });

    return timeBlocks.map(TimeBlockResponseDto.fromEntity);
  }

  async findByUser(
    professionalId: string,
    startDate?: Date,
    endDate?: Date,
    userId?: string,
  ): Promise<TimeBlockResponseDto[]> {
    const where: any = {
      user: { id: professionalId },
    };

    if (startDate && endDate) {
      where.start_datetime = Between(startDate, endDate);
    }

    // Validar que el profesional pertenece al tenant si se proporciona userId
    if (userId) {
      const professional = await this.usersService.findOne({
        id: professionalId,
      });
      if (!professional) {
        throw new NotFoundException(
          `Profesional con ID ${professionalId} no encontrado`,
        );
      }
      // Aquí podrías agregar validación adicional del tenant si es necesario
    }

    const timeBlocks = await this.timeBlockRepository.find({
      where,
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
      order: { start_datetime: 'ASC' },
    });

    return timeBlocks.map(TimeBlockResponseDto.fromEntity);
  }

  async findOne(id: string, userId: string): Promise<TimeBlockResponseDto> {
    const timeBlock = await this.getTimeBlockEntity(id, userId);
    return TimeBlockResponseDto.fromEntity(timeBlock);
  }

  async create(
    createTimeBlockDto: CreateTimeBlockDto,
    userId: string,
  ): Promise<TimeBlockResponseDto> {
    const { user_id, appointment_id, start_datetime, end_datetime, notes } =
      createTimeBlockDto;

    // Validar rango de fechas
    TimeBlock.validateDateRange(
      new Date(start_datetime),
      new Date(end_datetime),
    );

    try {
      // Verificar disponibilidad
      const isAvailable = await this.checkTimeBlockAvailability(
        user_id,
        new Date(start_datetime),
        new Date(end_datetime),
        undefined,
        userId,
      );

      if (!isAvailable) {
        throw new BadRequestException(ERROR_MESSAGES.UNAVAILABLE_SCHEDULE);
      }

      // Obtener el usuario y validar que pertenece al tenant
      const [userFound, appointmentFound] = await Promise.all([
        this.usersService.findOne({ id: user_id }),
        appointment_id
          ? this.appointmentsService.findOne(appointment_id, userId)
          : null,
      ]);

      if (!userFound) {
        throw new NotFoundException(`Usuario con ID ${user_id} no encontrado`);
      }

      // Crear el time block
      const timeBlock = this.timeBlockRepository.create({
        start_datetime: new Date(start_datetime),
        end_datetime: new Date(end_datetime),
        notes,
        user: userFound as User,
        appointment: appointmentFound,
      });

      const savedTimeBlock = await this.timeBlockRepository.save(timeBlock);
      return TimeBlockResponseDto.fromEntity(savedTimeBlock);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException('Error al crear el bloque de tiempo');
    }
  }

  async update(
    id: string,
    updateTimeBlockDto: UpdateTimeBlockDto,
    userId: string,
  ): Promise<TimeBlockResponseDto> {
    const timeBlock = await this.getTimeBlockEntity(id, userId);
    const { start_datetime, end_datetime, user_id, notes } = updateTimeBlockDto;

    try {
      if (start_datetime && end_datetime) {
        TimeBlock.validateDateRange(
          new Date(start_datetime),
          new Date(end_datetime),
        );

        const isAvailable = await this.checkTimeBlockAvailability(
          user_id || timeBlock.user.id,
          new Date(start_datetime),
          new Date(end_datetime),
          id,
          userId,
        );

        if (!isAvailable) {
          throw new BadRequestException(ERROR_MESSAGES.UNAVAILABLE_SCHEDULE);
        }
      }

      if (user_id) {
        const userFound = await this.usersService.findOne({ id: user_id });
        if (!userFound) {
          throw new NotFoundException(
            `Usuario con ID ${user_id} no encontrado`,
          );
        }
        timeBlock.user = userFound as User;
      }

      if (start_datetime) {
        timeBlock.start_datetime = new Date(start_datetime);
      }

      if (end_datetime) {
        timeBlock.end_datetime = new Date(end_datetime);
      }

      if (notes !== undefined) {
        timeBlock.notes = notes;
      }

      const updatedTimeBlock = await this.timeBlockRepository.save(timeBlock);
      return TimeBlockResponseDto.fromEntity(updatedTimeBlock);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new BadRequestException('Error al actualizar el bloque de tiempo');
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    const timeBlock = await this.getTimeBlockEntity(id, userId);
    await this.timeBlockRepository.remove(timeBlock);
  }

  async getAvailableSlots(
    professionalId: string,
    date: Date,
    duration: number,
    userId: string,
  ): Promise<Array<{ start: Date; end: Date }>> {
    // Validar que el profesional existe y pertenece al tenant
    const professional = await this.usersService.findOne({
      id: professionalId,
    });
    if (!professional) {
      throw new NotFoundException(
        `Profesional con ID ${professionalId} no encontrado`,
      );
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const timeBlocks = await this.findByUser(
      professionalId,
      startOfDay,
      endOfDay,
      userId,
    );

    const workingHours = {
      start: 9,
      end: 17,
      slotDuration: duration,
      intervalBetweenSlots: 0,
    };

    return this.calculateAvailableSlots(timeBlocks, workingHours, startOfDay);
  }

  private calculateAvailableSlots(
    existingBlocks: TimeBlockResponseDto[],
    workingHours: {
      start: number;
      end: number;
      slotDuration: number;
      intervalBetweenSlots: number;
    },
    date: Date,
  ): Array<{ start: Date; end: Date }> {
    const availableSlots: Array<{ start: Date; end: Date }> = [];
    const { start, end, slotDuration, intervalBetweenSlots } = workingHours;

    // Implementar lógica de cálculo de slots disponibles aquí
    // Considerando los bloques existentes y el horario laboral

    return availableSlots;
  }
}
