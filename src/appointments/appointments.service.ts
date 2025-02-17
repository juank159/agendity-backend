import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, Between } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ClientsService } from '../clients/clients.service';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';
import { RELATIONS, RELATION_GROUPS } from './constants/relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { AppointmentStatus, PaymentStatus } from 'src/common/enums/status.enum';

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
      console.log('Datos recibidos:', createAppointmentDto);

      const {
        client_id,
        professional_id,
        service_ids,
        date,
        ...appointmentData
      } = createAppointmentDto;

      const [client, professional] = await Promise.all([
        this.clientsService.findOne(client_id, userId),
        this.usersService.findOne({ id: professional_id }),
      ]);

      console.log('Cliente:', client);
      console.log('Profesional:', professional);

      if (!client || !professional) {
        throw new NotFoundException('Cliente o profesional no encontrado');
      }

      const services = await Promise.all(
        service_ids.map((id) => this.servicesService.findOne(id, userId)),
      );

      console.log('Servicios:', services);

      if (services.some((service) => !service)) {
        throw new NotFoundException('Uno o más servicios no encontrados');
      }

      const appointmentDate = new Date(date);
      console.log('Fecha convertida:', appointmentDate);

      const existingAppointment = await this.appointmentRepository
        .createQueryBuilder('appointment')
        .where('appointment.professional_id = :professionalId', {
          professionalId: professional_id,
        })
        .andWhere('appointment.date = :appointmentDate', {
          appointmentDate,
        })
        .andWhere('appointment.ownerId = :userId', {
          // Cambiado de owner_id a ownerId
          userId,
        })
        .getOne();

      if (existingAppointment) {
        throw new BadRequestException('Horario no disponible');
      }

      const appointmentToSave = {
        ownerId: userId, // Cambiado de owner_id a ownerId
        professionalId: professional_id, // Cambiado a professionalId para coincidir con la entidad
        date: new Date(createAppointmentDto.date),
        total_price: services.reduce(
          (sum, service) => sum + Number(service.price),
          0,
        ),
        status: AppointmentStatus.PENDING,
        payment_status: PaymentStatus.PENDING,
        notes: appointmentData.notes || '',
        client: client,
        professional: professional,
        services: services,
      };

      console.log('Objeto a guardar:', appointmentToSave);

      const savedAppointment =
        await this.appointmentRepository.save(appointmentToSave);
      console.log('Cita guardada:', savedAppointment);

      return savedAppointment;
    } catch (error) {
      console.error('Error en create:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Error al crear la cita');
    }
  }

  async findAllByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<Appointment[]> {
    try {
      return await this.appointmentRepository.find({
        where: {
          ownerId: userId,
          date: Between(startDate, endDate),
        },
        relations: ['client', 'professional', 'services'], // Aquí también
        order: {
          date: 'ASC',
        },
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
        detail: 'por rango de fechas',
      });
    }
  }

  async findAll(
    userId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Appointment[]> {
    try {
      if (startDate && endDate) {
        return this.findAllByDateRange(userId, startDate, endDate);
      }

      return await this.appointmentRepository.find({
        where: { ownerId: userId },
        relations: ['client', 'professional', 'services'], // Explícitamente definir las relaciones
        order: {
          date: 'ASC',
        },
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
        detail: startDate && endDate ? 'filtrado por fechas' : 'todas',
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
