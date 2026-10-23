import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
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
import {
  endOfBusinessDay,
  isValidDate,
  parseBusinessDate,
  startOfBusinessDay,
} from '../common/utils/date.util';

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
    private readonly dataSource: DataSource,
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

  /**
   * Regla única para guardar un bloqueo (crear y editar), DENTRO de la
   * transacción que lo guarda:
   * 1. Citas: `assertNoAppointmentOverlap` toma el lock del hueco del
   *    profesional (el mismo que las citas) y rechaza si se cruza con una cita
   *    no `CANCELLED` (salvo la cita ligada al bloqueo) → `SLOT_UNAVAILABLE`.
   * 2. Otros bloqueos del mismo profesional → 400 "El horario solicitado no
   *    está disponible" (como antes).
   * Intervalos semiabiertos [inicio, fin): un bloqueo puede empezar cuando
   * termina otro. Fechas como `Date` contra `timestamptz` (sin `OVERLAPS` con
   * parámetros sin tipo, que Postgres no sabía resolver).
   */
  private async assertBlockSlotFree(
    manager: EntityManager,
    slot: {
      tenantId: string;
      professionalId: string;
      start: Date;
      end: Date;
      appointmentId?: string | null;
      excludeBlockId?: string | null;
    },
  ): Promise<void> {
    TimeBlock.validateDateRange(slot.start, slot.end);

    await this.appointmentsService.assertNoAppointmentOverlap(manager, {
      tenantId: slot.tenantId,
      professionalId: slot.professionalId,
      start: slot.start,
      end: slot.end,
      excludeAppointmentId: slot.appointmentId ?? null,
    });

    const overlappingBlocks = await manager.query(
      `SELECT 1 FROM time_block tb
        WHERE tb."userId" = $1
          AND tb.start_datetime < $2
          AND tb.end_datetime > $3
          AND ($4::uuid IS NULL OR tb.id <> $4::uuid)
        LIMIT 1`,
      [slot.professionalId, slot.end, slot.start, slot.excludeBlockId ?? null],
    );
    if (overlappingBlocks.length) {
      throw new BadRequestException(ERROR_MESSAGES.UNAVAILABLE_SCHEDULE);
    }
  }

  /** Cadena ISO del DTO → `Date` (sin offset = hora del negocio). */
  private toDate(value: string): Date {
    const date = parseBusinessDate(value);
    if (!isValidDate(date)) {
      throw new BadRequestException('Fecha inválida');
    }
    return date;
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
    // Filtros opcionales: ninguno = todos; uno solo = desde/hasta.
    if (startDate && endDate) {
      where.start_datetime = Between(startDate, endDate);
    } else if (startDate) {
      where.start_datetime = MoreThanOrEqual(startDate);
    } else if (endDate) {
      where.start_datetime = LessThanOrEqual(endDate);
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
    const { user_id, appointment_id, notes } = createTimeBlockDto;
    const start = this.toDate(createTimeBlockDto.start_datetime);
    const end = this.toDate(createTimeBlockDto.end_datetime);
    TimeBlock.validateDateRange(start, end);

    // Profesional y cita deben ser del negocio (si no, 404)
    const [userFound, appointmentFound] = await Promise.all([
      this.usersService.findTenantMember(user_id, tenantId),
      appointment_id
        ? this.appointmentsService.findOne(appointment_id, tenantId)
        : null,
    ]);

    const savedTimeBlock = await this.dataSource.transaction(
      async (manager) => {
        await this.assertBlockSlotFree(manager, {
          tenantId,
          professionalId: user_id,
          start,
          end,
          appointmentId: appointmentFound?.id,
        });

        const repository = manager.getRepository(TimeBlock);
        return repository.save(
          repository.create({
            start_datetime: start,
            end_datetime: end,
            notes,
            user: userFound as User,
            appointment: appointmentFound,
          }),
        );
      },
    );
    return TimeBlockResponseDto.fromEntity(savedTimeBlock);
  }

  async update(
    id: string,
    updateTimeBlockDto: UpdateTimeBlockDto,
    tenantId: string,
  ): Promise<TimeBlockResponseDto> {
    const timeBlock = await this.getTimeBlockEntity(id, tenantId);
    const { start_datetime, end_datetime, user_id, notes } = updateTimeBlockDto;

    if (user_id) {
      // El nuevo profesional también debe ser del negocio
      timeBlock.user = await this.usersService.findTenantMember(
        user_id,
        tenantId,
      );
    }
    if (start_datetime) timeBlock.start_datetime = this.toDate(start_datetime);
    if (end_datetime) timeBlock.end_datetime = this.toDate(end_datetime);
    if (notes !== undefined) timeBlock.notes = notes;

    // Cualquier cambio de hueco (inicio, fin o profesional, aunque llegue solo
    // uno) se valida con el rango resultante.
    const slotChanged = !!(start_datetime || end_datetime || user_id);

    const updatedTimeBlock = await this.dataSource.transaction(
      async (manager) => {
        if (slotChanged) {
          await this.assertBlockSlotFree(manager, {
            tenantId,
            professionalId: timeBlock.user.id,
            start: timeBlock.start_datetime,
            end: timeBlock.end_datetime,
            appointmentId: timeBlock.appointment?.id,
            excludeBlockId: id,
          });
        }
        return manager.getRepository(TimeBlock).save(timeBlock);
      },
    );
    return TimeBlockResponseDto.fromEntity(updatedTimeBlock);
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
    // Día del negocio (BUSINESS_TIMEZONE), no el del servidor
    const startOfDay = startOfBusinessDay(date);
    const endOfDay = endOfBusinessDay(date);

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
