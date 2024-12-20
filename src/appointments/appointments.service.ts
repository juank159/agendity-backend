import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ClientsService } from '../clients/clients.service';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';
import { User } from 'src/users/entities/user.entity';
import { AppointmentFindOptions } from './interfaces/appointment-find-options.interface';
import { AppointmentErrorHandlerOptions } from './interfaces/error-handler-options.interface';

@Injectable()
export class AppointmentsService {
  private RELATIONS = {
    default: ['client', 'professional', 'service'],
    full: ['client', 'professional', 'service', 'service.category'],
    minimal: ['professional', 'service'],
  } as {
    default: string[];
    full: string[];
    minimal: string[];
  };

  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    private readonly clientsService: ClientsService,
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
  ) {}

  private handleError(
    error: any,
    options: AppointmentErrorHandlerOptions,
  ): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. ${options.detail || 'Por favor, intenta nuevamente.'}`,
    );
  }

  private async findAppointment(
    options: AppointmentFindOptions,
  ): Promise<Appointment> {
    const {
      id,
      professionalId,
      date,
      excludeId,
      loadRelations = true,
    } = options;

    try {
      const queryBuilder =
        this.appointmentRepository.createQueryBuilder('appointment');

      if (loadRelations) {
        this.RELATIONS.default.forEach((relation) => {
          queryBuilder.leftJoinAndSelect(`appointment.${relation}`, relation);
        });
      }

      if (id) {
        queryBuilder.andWhere('appointment.id = :id', { id });
      }

      if (professionalId) {
        queryBuilder.andWhere('appointment.professional.id = :professionalId', {
          professionalId,
        });
      }

      if (date) {
        queryBuilder.andWhere('appointment.date = :date', { date });
      }

      if (excludeId) {
        queryBuilder.andWhere('appointment.id != :excludeId', { excludeId });
      }

      const appointment = await queryBuilder.getOne();

      if (!appointment && id) {
        throw new NotFoundException(`Cita con ID ${id} no encontrada`);
      }

      return appointment;
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'buscar',
      });
    }
  }

  private async checkAvailability(
    professionalId: string,
    date: Date,
    excludeAppointmentId?: string,
  ): Promise<boolean> {
    const existingAppointment = await this.findAppointment({
      professionalId,
      date,
      excludeId: excludeAppointmentId,
      loadRelations: false,
    });

    return !existingAppointment;
  }

  async create(
    createAppointmentDto: CreateAppointmentDto,
  ): Promise<Appointment> {
    const {
      client_id,
      professional_id,
      service_id,
      owner_id,
      ...appointmentData
    } = createAppointmentDto;

    try {
      // Verificar todas las entidades necesarias
      const [client, professional, service] = await Promise.all([
        this.clientsService.findOne(client_id),
        this.usersService.findOne({ id: professional_id }),
        this.servicesService.findOne(service_id, owner_id),
      ]);

      // Verificar disponibilidad
      const isAvailable = await this.checkAvailability(
        professional_id,
        appointmentData.date,
      );
      if (!isAvailable) {
        throw new BadRequestException(
          'El profesional no está disponible en ese horario',
        );
      }

      const appointment = this.appointmentRepository.create({
        ...appointmentData,
        client,
        professional: professional as User,
        service,
      });

      return await this.appointmentRepository.save(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'crear',
      });
    }
  }

  async findAll(): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        relations: this.RELATIONS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
      });
    }
  }

  async findOne(id: string): Promise<Appointment> {
    return await this.findAppointment({ id });
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id);

      if (updateAppointmentDto.date) {
        const isAvailable = await this.checkAvailability(
          appointment.professional.id,
          updateAppointmentDto.date,
          id,
        );
        if (!isAvailable) {
          throw new BadRequestException(
            'El profesional no está disponible en ese horario',
          );
        }
      }

      const updatedAppointment = this.appointmentRepository.create({
        ...appointment,
        ...updateAppointmentDto,
      });

      return await this.appointmentRepository.save(updatedAppointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const appointment = await this.findOne(id);
      await this.appointmentRepository.remove(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'eliminar',
      });
    }
  }

  async findByProfessionalAndDate(
    professionalId: string,
    date: Date,
  ): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: {
          professional: { id: professionalId },
          date,
        },
        relations: ['professional', 'service'],
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'buscar',
      });
    }
  }
}
