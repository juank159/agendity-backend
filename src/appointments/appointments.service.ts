import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ClientsService } from '../clients/clients.service';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';
import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    private readonly clientsService: ClientsService,
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  async create(
    createAppointmentDto: CreateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    try {
      const { client_id, professional_id, service_id, ...appointmentData } =
        createAppointmentDto;

      // Verificar todas las entidades necesarias
      const [client, professional, service] = await Promise.all([
        this.clientsService.findOne(client_id, userId),
        this.usersService.findOne({ id: professional_id }),
        this.servicesService.findOne(service_id, userId),
      ]);

      // Verificar disponibilidad
      const existingAppointment = await this.appointmentRepository.findOne({
        where: {
          professional: { id: professional_id },
          date: appointmentData.date,
          ownerId: userId,
        },
      });

      if (existingAppointment) {
        throw new BadRequestException(
          'El profesional no está disponible en ese horario',
        );
      }

      const appointment = this.appointmentRepository.create({
        ...appointmentData,
        client,
        professional,
        service,
        ownerId: userId,
      });

      return await this.appointmentRepository.save(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'crear',
      });
    }
  }

  async findAll(userId: string): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: { ownerId: userId },
        relations: RELATION_GROUPS.default,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
      });
    }
  }

  async findOne(id: string, userId: string): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, ownerId: userId },
      relations: RELATION_GROUPS.default,
    });

    if (!appointment) {
      throw new NotFoundException(`Cita con ID ${id} no encontrada`);
    }

    return appointment;
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    userId: string,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id, userId);

      if (updateAppointmentDto.date) {
        const existingAppointment = await this.appointmentRepository
          .createQueryBuilder('appointment')
          .where('appointment.professional_id = :professionalId', {
            professionalId: appointment.professional.id,
          })
          .andWhere('appointment.date = :date', {
            date: updateAppointmentDto.date,
          })
          .andWhere('appointment.id != :id', { id })
          .andWhere('appointment.owner_id = :ownerId', { ownerId: userId })
          .getOne();

        if (existingAppointment) {
          throw new BadRequestException(
            'El profesional no está disponible en ese horario',
          );
        }
      }

      const updatedAppointment = await this.appointmentRepository.save({
        ...appointment,
        ...updateAppointmentDto,
      });

      return updatedAppointment;
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    try {
      const appointment = await this.findOne(id, userId);
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
    userId: string,
  ): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: {
          professional: { id: professionalId },
          date,
          ownerId: userId,
        },
        relations: RELATION_GROUPS.minimal,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'buscar',
      });
    }
  }
}
