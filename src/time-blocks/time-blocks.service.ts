import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { TimeBlock } from './entities/time-block.entity';
import { CreateTimeBlockDto } from './dto/create-time-block.dto';
import { UpdateTimeBlockDto } from './dto/update-time-block.dto';
import { UsersService } from '../users/users.service';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class TimeBlocksService {
  constructor(
    @InjectRepository(TimeBlock)
    private readonly timeBlockRepository: Repository<TimeBlock>,
    private readonly usersService: UsersService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async findAll(): Promise<TimeBlock[]> {
    return await this.timeBlockRepository.find({
      relations: ['user', 'appointment'],
    });
  }

  async findByUser(userId: string, startDate?: Date, endDate?: Date): Promise<TimeBlock[]> {
    const where: any = { user: { id: userId } };

    if (startDate && endDate) {
      where.start_datetime = Between(startDate, endDate);
    }

    return await this.timeBlockRepository.find({
      where,
      relations: ['user', 'appointment'],
      order: { start_datetime: 'ASC' },
    });
  }

  async findOne(id: string): Promise<TimeBlock> {
    const timeBlock = await this.timeBlockRepository.findOne({
      where: { id },
      relations: ['user', 'appointment'],
    });

    if (!timeBlock) {
      throw new NotFoundException(`Bloque de tiempo con ID ${id} no encontrado`);
    }

    return timeBlock;
  }


 

async update(id: string, updateTimeBlockDto: UpdateTimeBlockDto): Promise<TimeBlock> {
  const timeBlock = await this.findOne(id);
  const { start_datetime, end_datetime, user_id } = updateTimeBlockDto;

  if (start_datetime && end_datetime) {
    if (new Date(start_datetime) >= new Date(end_datetime)) {
      throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
    }

    const isAvailable = await this.checkAvailability(
      user_id || timeBlock.user.id,
      new Date(start_datetime),
      new Date(end_datetime),
      id
    );

    if (!isAvailable) {
      throw new BadRequestException('El horario solicitado no está disponible');
    }
  }

  if (user_id) {
    const newUser = await this.usersService.findOne({ id: user_id });
    return await this.timeBlockRepository.save({
      ...timeBlock,
      user: newUser,
      start_datetime: start_datetime ? new Date(start_datetime) : timeBlock.start_datetime,
      end_datetime: end_datetime ? new Date(end_datetime) : timeBlock.end_datetime,
    });
  }

  const updatedTimeBlock = {
    ...timeBlock,
    start_datetime: start_datetime ? new Date(start_datetime) : timeBlock.start_datetime,
    end_datetime: end_datetime ? new Date(end_datetime) : timeBlock.end_datetime,
  };

  return await this.timeBlockRepository.save(updatedTimeBlock);
}

async create(createTimeBlockDto: CreateTimeBlockDto): Promise<TimeBlock> {
  const { user_id, appointment_id, start_datetime, end_datetime } = createTimeBlockDto;

  if (new Date(start_datetime) >= new Date(end_datetime)) {
    throw new BadRequestException('La fecha de inicio debe ser anterior a la fecha de fin');
  }

  const isAvailable = await this.checkAvailability(
    user_id,
    new Date(start_datetime),
    new Date(end_datetime)
  );

  if (!isAvailable) {
    throw new BadRequestException('El horario solicitado no está disponible');
  }

  // Obtenemos el usuario completo
  const user = await this.usersService.findOne({ id: user_id });
  let appointment = null;

  if (appointment_id) {
    appointment = await this.appointmentsService.findOne(appointment_id);
  }

  const timeBlock = this.timeBlockRepository.create({
    start_datetime: new Date(start_datetime),
    end_datetime: new Date(end_datetime),
    notes: createTimeBlockDto.notes,
    user, // Asignamos el usuario completo
    appointment,
  });

  return await this.timeBlockRepository.save(timeBlock);
}

  async remove(id: string): Promise<void> {
    const timeBlock = await this.findOne(id);
    await this.timeBlockRepository.remove(timeBlock);
  }

  async checkAvailability(
    userId: string,
    startDatetime: Date,
    endDatetime: Date,
    excludeBlockId?: string
  ): Promise<boolean> {
    const queryBuilder = this.timeBlockRepository
      .createQueryBuilder('time_block')
      .where('time_block.user.id = :userId', { userId })
      .andWhere(
        '(time_block.start_datetime, time_block.end_datetime) OVERLAPS (:startDatetime, :endDatetime)',
        { startDatetime, endDatetime }
      );

    if (excludeBlockId) {
      queryBuilder.andWhere('time_block.id != :excludeBlockId', { excludeBlockId });
    }

    const overlappingBlock = await queryBuilder.getOne();
    return !overlappingBlock;
  }

  async getAvailableSlots(
    userId: string,
    date: Date,
    duration: number // duración en minutos
  ): Promise<Array<{ start: Date; end: Date }>> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const timeBlocks = await this.timeBlockRepository.find({
      where: {
        user: { id: userId },
        start_datetime: MoreThanOrEqual(startOfDay),
        end_datetime: LessThanOrEqual(endOfDay)
      },
      order: { start_datetime: 'ASC' }
    });

    // Aquí implementarías la lógica para encontrar slots disponibles
    // basándote en los horarios del profesional y los bloques ocupados
    const availableSlots = [];
    // ... lógica para calcular slots disponibles

    return availableSlots;
  }
}