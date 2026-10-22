import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { TimeBlock } from './entities/time-block.entity';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { UpdateTimeBlockDto } from './dto/update-time-block.dto';
import { UsersService } from '../users/users.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { User } from '../users/entities/user.entity';
import { tenantMembersWhere } from '../users/user-access';

import {
  TIME_BLOCK_RELATIONS,
  ERROR_MESSAGES,
} from './constants/time-block.constants';
import { TimeBlockResponseDto } from './dto/time-block.response.dto';

/**
 * Los bloques no tienen `owner_id`: pertenecen al profesional (`user`), y el
 * profesional pertenece al negocio (es el Owner o uno de sus empleados).
 */
@Injectable()
export class TimeBlocksService {
  constructor(
    @InjectRepository(TimeBlock)
    private readonly timeBlockRepository: Repository<TimeBlock>,
    private readonly usersService: UsersService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /** `where` de bloques del negocio (OR: del Owner o de sus empleados). */
  private tenantWhere(
    tenantId: string,
    extra: FindOptionsWhere<TimeBlock> = {},
  ): FindOptionsWhere<TimeBlock>[] {
    return tenantMembersWhere(tenantId).map((user) => ({ ...extra, user }));
  }

  private async getTimeBlockEntity(
    id: string,
    tenantId: string,
  ): Promise<TimeBlock> {
    const timeBlock = await this.timeBlockRepository.findOne({
      where: this.tenantWhere(tenantId, { id }),
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
    });

    if (!timeBlock) {
      throw new NotFoundException(ERROR_MESSAGES.NOT_FOUND(id));
    }

    return timeBlock;
  }

  /** Solapamiento con otros bloques del mismo profesional (ya validado en el negocio). */
  private async checkTimeBlockAvailability(
    professionalId: string,
    startDatetime: Date,
    endDatetime: Date,
    excludeBlockId?: string,
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

    const overlappingBlock = await queryBuilder.getOne();
    return !overlappingBlock;
  }

  async findAll(tenantId: string): Promise<TimeBlockResponseDto[]> {
    const timeBlocks = await this.timeBlockRepository.find({
      where: this.tenantWhere(tenantId),
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
    });

    return timeBlocks.map(TimeBlockResponseDto.fromEntity);
  }

  async findByUser(
    professionalId: string,
    startDate: Date | undefined,
    endDate: Date | undefined,
    tenantId: string,
  ): Promise<TimeBlockResponseDto[]> {
    // El profesional debe ser del negocio (si no, 404)
    await this.usersService.findTenantMember(professionalId, tenantId);

    const where: FindOptionsWhere<TimeBlock> = {
      user: { id: professionalId },
    };
    if (startDate && endDate) {
      where.start_datetime = Between(startDate, endDate);
    }

    const timeBlocks = await this.timeBlockRepository.find({
      where,
      relations: [TIME_BLOCK_RELATIONS.USER, TIME_BLOCK_RELATIONS.APPOINTMENT],
      order: { start_datetime: 'ASC' },
    });

    return timeBlocks.map(TimeBlockResponseDto.fromEntity);
  }

  async findOne(id: string, tenantId: string): Promise<TimeBlockResponseDto> {
    const timeBlock = await this.getTimeBlockEntity(id, tenantId);
    return TimeBlockResponseDto.fromEntity(timeBlock);
  }

  async create(
    createTimeBlockDto: CreateTimeBlockDto,
    tenantId: string,
  ): Promise<TimeBlockResponseDto> {
    const { user_id, appointment_id, start_datetime, end_datetime, notes } =
      createTimeBlockDto;

    // Validar rango de fechas
    TimeBlock.validateDateRange(
      new Date(start_datetime),
      new Date(end_datetime),
    );

    try {
      // Profesional y cita deben ser del negocio (si no, 404)
      const [userFound, appointmentFound] = await Promise.all([
        this.usersService.findTenantMember(user_id, tenantId),
        appointment_id
          ? this.appointmentsService.findOne(appointment_id, tenantId)
          : null,
      ]);

      const isAvailable = await this.checkTimeBlockAvailability(
        user_id,
        new Date(start_datetime),
        new Date(end_datetime),
      );

      if (!isAvailable) {
        throw new BadRequestException(ERROR_MESSAGES.UNAVAILABLE_SCHEDULE);
      }

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
    tenantId: string,
  ): Promise<TimeBlockResponseDto> {
    const timeBlock = await this.getTimeBlockEntity(id, tenantId);
    const { start_datetime, end_datetime, user_id, notes } = updateTimeBlockDto;

    try {
      if (user_id) {
        // El nuevo profesional también debe ser del negocio
        timeBlock.user = await this.usersService.findTenantMember(
          user_id,
          tenantId,
        );
      }

      if (start_datetime && end_datetime) {
        TimeBlock.validateDateRange(
          new Date(start_datetime),
          new Date(end_datetime),
        );

        const isAvailable = await this.checkTimeBlockAvailability(
          timeBlock.user.id,
          new Date(start_datetime),
          new Date(end_datetime),
          id,
        );

        if (!isAvailable) {
          throw new BadRequestException(ERROR_MESSAGES.UNAVAILABLE_SCHEDULE);
        }
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

  async remove(id: string, tenantId: string): Promise<void> {
    const timeBlock = await this.getTimeBlockEntity(id, tenantId);
    await this.timeBlockRepository.remove(timeBlock);
  }

  async getAvailableSlots(
    professionalId: string,
    date: Date,
    duration: number,
    tenantId: string,
  ): Promise<Array<{ start: Date; end: Date }>> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // findByUser valida que el profesional sea del negocio (404 si no)
    const timeBlocks = await this.findByUser(
      professionalId,
      startOfDay,
      endOfDay,
      tenantId,
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
