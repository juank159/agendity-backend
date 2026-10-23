import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Schedule } from './entities/schedule.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UsersService } from '../users/users.service';
import { tenantMembersWhere } from 'src/users/user-access';
import { timeToMinutes } from 'src/appointments/appointment-slot';

/**
 * Los horarios no tienen `owner_id`: pertenecen a un profesional (`user`), que es
 * el Owner o un empleado del negocio. Todo se filtra por ese vínculo.
 */
@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(Schedule)
    private readonly scheduleRepository: Repository<Schedule>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  /** `where` de horarios del negocio (OR: del Owner o de sus empleados). */
  private tenantWhere(
    tenantId: string,
    extra: FindOptionsWhere<Schedule> = {},
  ): FindOptionsWhere<Schedule>[] {
    return tenantMembersWhere(tenantId).map((user) => ({ ...extra, user }));
  }

  async create(
    createScheduleDto: CreateScheduleDto,
    tenantId: string,
  ): Promise<Schedule> {
    const { user_id, ...scheduleData } = createScheduleDto;

    // El profesional debe ser del negocio (si no, 404)
    const user = await this.usersService.findTenantMember(user_id, tenantId);

    // Validar que start_time sea anterior a end_time
    if (scheduleData.start_time >= scheduleData.end_time) {
      throw new BadRequestException(
        'La hora de inicio debe ser anterior a la hora de fin',
      );
    }

    // Verificar que no exista solapamiento de horarios
    await this.validateScheduleOverlap(
      user_id,
      scheduleData.day_of_week,
      scheduleData.start_time,
      scheduleData.end_time,
    );

    const schedule = this.scheduleRepository.create({
      ...scheduleData,
      user,
    });

    return await this.scheduleRepository.save(schedule);
  }

  async createBatch(
    userId: string,
    schedules: Omit<CreateScheduleDto, 'user_id'>[],
    tenantId: string,
  ): Promise<Schedule[]> {
    // El profesional debe ser del negocio (si no, 404)
    const user = await this.usersService.findTenantMember(userId, tenantId);

    const createdSchedules: Schedule[] = [];

    for (const scheduleData of schedules) {
      // Validar que start_time sea anterior a end_time
      if (scheduleData.start_time >= scheduleData.end_time) {
        throw new BadRequestException(
          'La hora de inicio debe ser anterior a la hora de fin',
        );
      }

      // Verificar que no exista solapamiento de horarios
      await this.validateScheduleOverlap(
        userId,
        scheduleData.day_of_week,
        scheduleData.start_time,
        scheduleData.end_time,
      );

      const schedule = this.scheduleRepository.create({
        ...scheduleData,
        user,
      });

      createdSchedules.push(await this.scheduleRepository.save(schedule));
    }

    return createdSchedules;
  }

  /** Todos los horarios de todos los negocios: solo para Admin. */
  async findAllForAdmin(): Promise<Schedule[]> {
    return await this.scheduleRepository.find({
      relations: ['user'],
    });
  }

  async findByUser(userId: string, tenantId: string): Promise<Schedule[]> {
    await this.usersService.findTenantMember(userId, tenantId);
    return await this.scheduleRepository.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });
  }

  async findOne(id: string, tenantId: string): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findOne({
      where: this.tenantWhere(tenantId, { id }),
      relations: ['user'],
    });

    if (!schedule) {
      throw new NotFoundException(`Horario con ID ${id} no encontrado`);
    }

    return schedule;
  }

  async update(
    id: string,
    updateScheduleDto: UpdateScheduleDto,
    tenantId: string,
  ): Promise<Schedule> {
    const schedule = await this.findOne(id, tenantId);
    const { user_id, ...scheduleData } = updateScheduleDto;

    if (user_id) {
      // El nuevo profesional también debe ser del negocio
      schedule.user = await this.usersService.findTenantMember(
        user_id,
        tenantId,
      );
    }

    if (
      user_id ||
      scheduleData.day_of_week ||
      scheduleData.start_time ||
      scheduleData.end_time
    ) {
      // Rango resultante (aunque llegue solo una de las dos horas). La BD
      // devuelve `HH:mm:ss`: se compara en minutos, no como texto.
      const startTime = scheduleData.start_time || schedule.start_time;
      const endTime = scheduleData.end_time || schedule.end_time;
      if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
        throw new BadRequestException(
          'La hora de inicio debe ser anterior a la hora de fin',
        );
      }
      await this.validateScheduleOverlap(
        schedule.user.id,
        scheduleData.day_of_week || schedule.day_of_week,
        startTime,
        endTime,
        id,
      );
    }

    Object.assign(schedule, scheduleData);
    return await this.scheduleRepository.save(schedule);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const schedule = await this.findOne(id, tenantId);
    await this.scheduleRepository.remove(schedule);
  }

  private async validateScheduleOverlap(
    userId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    excludeId?: string,
  ): Promise<void> {
    const queryBuilder = this.scheduleRepository
      .createQueryBuilder('schedule')
      .where('schedule.user.id = :userId', { userId })
      .andWhere('schedule.day_of_week = :dayOfWeek', { dayOfWeek })
      // Parámetros con tipo explícito: sin el CAST, Postgres no sabe qué
      // `overlaps` usar con (time, time, unknown, unknown) y daba 500 (2.08).
      .andWhere(
        '(schedule.start_time, schedule.end_time) OVERLAPS (CAST(:startTime AS time), CAST(:endTime AS time))',
        { startTime, endTime },
      );

    if (excludeId) {
      queryBuilder.andWhere('schedule.id != :excludeId', { excludeId });
    }

    const overlappingSchedule = await queryBuilder.getOne();

    if (overlappingSchedule) {
      throw new BadRequestException('El horario se solapa con otro existente');
    }
  }
}
