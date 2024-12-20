import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule } from './entities/schedule.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UsersService } from '../users/users.service';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class SchedulesService {
  constructor(
    @InjectRepository(Schedule)
    private readonly scheduleRepository: Repository<Schedule>,
    private readonly usersService: UsersService,
  ) {}

  async create(createScheduleDto: CreateScheduleDto): Promise<Schedule> {
    const { user_id, ...scheduleData } = createScheduleDto;

    // Verificar que existe el profesional
    const user = await this.usersService.findOne({ id: user_id });

    // Verificar que no exista solapamiento de horarios
    await this.validateScheduleOverlap(user_id, scheduleData.day_of_week, scheduleData.start_time, scheduleData.end_time);

    // Validar que start_time sea anterior a end_time
    if (scheduleData.start_time >= scheduleData.end_time) {
      throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
    }

    const schedule = this.scheduleRepository.create({
      ...scheduleData,
      user // Asignamos el usuario directamente
    });

    return await this.scheduleRepository.save(schedule);
}

  async findAll(): Promise<Schedule[]> {
    return await this.scheduleRepository.find({
      relations: ['user'],
    });
  }

  async findByUser(userId: string): Promise<Schedule[]> {
    return await this.scheduleRepository.find({
      where: { user: { id: userId } },
      relations: ['user'],
    });
  }

  async findOne(id: string): Promise<Schedule> {
    const schedule = await this.scheduleRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!schedule) {
      throw new NotFoundException(`Horario con ID ${id} no encontrado`);
    }

    return schedule;
  }

  async update(id: string, updateScheduleDto: UpdateScheduleDto): Promise<Schedule> {
    const schedule = await this.findOne(id);
    const { user_id, ...scheduleData } = updateScheduleDto;

    if (user_id) {
      const newUser = await this.usersService.findOne({ id: user_id });
      // Usamos type assertion para forzar el tipo User
      schedule.user = newUser as unknown as User;
    }

    if (scheduleData.day_of_week || scheduleData.start_time || scheduleData.end_time) {
      await this.validateScheduleOverlap(
        schedule.user.id,
        scheduleData.day_of_week || schedule.day_of_week,
        scheduleData.start_time || schedule.start_time,
        scheduleData.end_time || schedule.end_time,
        id
      );
    }

    if (scheduleData.start_time && scheduleData.end_time) {
      if (scheduleData.start_time >= scheduleData.end_time) {
        throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
      }
    }

    Object.assign(schedule, scheduleData);
    return await this.scheduleRepository.save(schedule);
}

  async remove(id: string): Promise<void> {
    const schedule = await this.findOne(id);
    await this.scheduleRepository.remove(schedule);
  }

  private async validateScheduleOverlap(
    userId: string,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    excludeId?: string
  ): Promise<void> {
    const queryBuilder = this.scheduleRepository
      .createQueryBuilder('schedule')
      .where('schedule.user.id = :userId', { userId })
      .andWhere('schedule.day_of_week = :dayOfWeek', { dayOfWeek })
      .andWhere(
        '(schedule.start_time, schedule.end_time) OVERLAPS (:startTime, :endTime)',
        { startTime, endTime }
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