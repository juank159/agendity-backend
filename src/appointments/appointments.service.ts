import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Not,
  Between,
  FindOptionsWhere,
  DataSource,
} from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { ClientsService } from '../clients/clients.service';
import { UsersService } from '../users/users.service';
import { ServicesService } from '../services/services.service';
import { RELATION_GROUPS } from './constants/relations.constants';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode, LEGACY_STATUS } from 'src/common/constants/error-codes';
import { AppointmentStatus, PaymentStatus } from 'src/common/enums/status.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';
import { AppointmentScope, toAppointmentScope } from './appointment-scope';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    private readonly clientsService: ClientsService,
    private readonly usersService: UsersService,
    private readonly servicesService: ServicesService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(
      `Error al ${options.operation} ${options.entity}:`,
      error?.message,
    );

    if (error instanceof HttpException) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  /** `where` de una cita según el alcance (negocio y, si aplica, profesional). */
  private scopeWhere(scope: AppointmentScope): FindOptionsWhere<Appointment> {
    if (!scope?.tenantId) {
      // TypeORM ignora `ownerId: undefined`: nunca consultar sin tenant.
      throw new NotFoundException('Cita no encontrada');
    }
    return scope.professionalId
      ? { ownerId: scope.tenantId, professionalId: scope.professionalId }
      : { ownerId: scope.tenantId };
  }

  /**
   * Crea una cita del negocio `tenantId` (Owner o Employee). Cliente, profesional
   * y servicios deben ser del mismo negocio (si no, 404); se validan antes de
   * tocar la suscripción. Después, en UNA transacción: se consume el cupo
   * (trial o plan, con lock por negocio), se comprueba el horario y se guarda.
   * Si algo falla, el rollback devuelve la cita al cupo.
   */
  async create(
    createAppointmentDto: CreateAppointmentDto,
    tenantId: string,
  ): Promise<Appointment> {
    try {
      const {
        client_id,
        professional_id,
        service_ids,
        date,
        ...appointmentData
      } = createAppointmentDto;

      const [client, professional] = await Promise.all([
        this.clientsService.findOne(client_id, tenantId),
        this.usersService.findTenantMember(professional_id, tenantId),
      ]);

      if (!client || !professional) {
        throw new NotFoundException('Cliente o profesional no encontrado');
      }

      const services = await Promise.all(
        service_ids.map((id) => this.servicesService.findOne(id, tenantId)),
      );

      if (services.some((service) => !service)) {
        throw new NotFoundException('Uno o más servicios no encontrados');
      }

      const appointmentToSave = {
        ownerId: tenantId,
        professionalId: professional_id,
        date: new Date(date),
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

      const savedAppointment = await this.dataSource.transaction(
        async (manager) => {
          // Lanza TRIAL_LIMIT_REACHED / SUBSCRIPTION_INACTIVE (HTTP 400 legado).
          await this.subscriptionsService.consumeAppointmentQuota(
            tenantId,
            manager,
          );

          const isAvailable = await this.checkProfessionalAvailability(
            professional_id,
            date,
            services,
            tenantId,
          );

          if (!isAvailable) {
            throw new BusinessException(
              ErrorCode.SLOT_UNAVAILABLE,
              'Horario no disponible',
              LEGACY_STATUS.SLOT_UNAVAILABLE,
            );
          }

          return await manager
            .getRepository(Appointment)
            .save(appointmentToSave);
        },
      );

      // Emitir el evento después de guardar la cita
      this.eventEmitter.emit('appointment.created', savedAppointment);

      return savedAppointment;
    } catch (error) {
      console.error('Error en create:', error?.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al crear la cita');
    }
  }

  // Verifica que el profesional no tenga otra cita del negocio que se solape (regla actual; la revisa 2.04).
  async checkProfessionalAvailability(
    professionalId: string,
    appointmentDateTime: string | Date,
    services: any[],
    tenantId: string,
  ): Promise<boolean> {
    try {
      const appointmentDate = new Date(appointmentDateTime);

      // 1. Calcular la duración total de los servicios solicitados
      const totalDurationMinutes = services.reduce(
        (sum, service) =>
          sum + (service.duration ? parseInt(service.duration) : 30),
        0,
      );

      // 2. Calcular la hora de finalización estimada
      const appointmentEndTime = new Date(appointmentDate);
      appointmentEndTime.setMinutes(
        appointmentEndTime.getMinutes() + totalDurationMinutes,
      );

      // 3. Buscar todas las citas del profesional para ese día
      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const appointmentsForDay = await this.appointmentRepository.find({
        where: {
          professionalId,
          ownerId: tenantId,
          date: Between(startOfDay, endOfDay),
        },
        relations: ['services'],
      });

      // 4. Verificar si hay solapamiento con alguna cita existente
      for (const existingAppointment of appointmentsForDay) {
        const existingDuration = existingAppointment.services.reduce(
          (sum, service) => sum + (service.duration || 30),
          0,
        );

        const existingStartTime = new Date(existingAppointment.date);
        const existingEndTime = new Date(existingStartTime);
        existingEndTime.setMinutes(
          existingEndTime.getMinutes() + existingDuration,
        );

        const hasOverlap =
          // Caso 1: La nueva cita comienza durante una cita existente
          (appointmentDate >= existingStartTime &&
            appointmentDate < existingEndTime) ||
          // Caso 2: La nueva cita termina durante una cita existente
          (appointmentEndTime > existingStartTime &&
            appointmentEndTime <= existingEndTime) ||
          // Caso 3: La nueva cita contiene completamente una cita existente
          (appointmentDate <= existingStartTime &&
            appointmentEndTime >= existingEndTime);

        if (hasOverlap) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error al verificar disponibilidad:', error?.message);
      throw new InternalServerErrorException(
        'Error al verificar disponibilidad',
      );
    }
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    tenantId: string,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id, tenantId);

      // Crear objeto para actualización
      const updateData: any = {};

      // Copiar campos simples
      if (updateAppointmentDto.date)
        updateData.date = new Date(updateAppointmentDto.date);
      if (updateAppointmentDto.notes !== undefined)
        updateData.notes = updateAppointmentDto.notes;
      if (updateAppointmentDto.status)
        updateData.status = updateAppointmentDto.status;

      if (updateAppointmentDto.payment_status)
        updateData.payment_status = updateAppointmentDto.payment_status;

      // El nuevo profesional debe ser del mismo negocio (si no, 404)
      if (updateAppointmentDto.professional_id) {
        const professional = await this.usersService.findTenantMember(
          updateAppointmentDto.professional_id,
          tenantId,
        );

        updateData.professionalId = updateAppointmentDto.professional_id;
        updateData.professional = professional;
      }

      if (updateAppointmentDto.client_id) {
        const client = await this.clientsService.findOne(
          updateAppointmentDto.client_id,
          tenantId,
        );
        if (!client) {
          throw new NotFoundException('Cliente no encontrado');
        }
        updateData.client = client;
      }

      if (
        updateAppointmentDto.service_ids &&
        updateAppointmentDto.service_ids.length > 0
      ) {
        const services = await Promise.all(
          updateAppointmentDto.service_ids.map((id) =>
            this.servicesService.findOne(id, tenantId),
          ),
        );

        if (services.some((service) => !service)) {
          throw new NotFoundException('Uno o más servicios no encontrados');
        }

        updateData.services = services;

        // Actualizar precio total
        updateData.total_price = services.reduce(
          (sum, service) => sum + Number(service.price),
          0,
        );
      }

      // Verificar disponibilidad (si es necesario)
      if (
        updateAppointmentDto.professional_id ||
        updateAppointmentDto.date ||
        updateAppointmentDto.service_ids
      ) {
        const professionalId =
          updateAppointmentDto.professional_id || appointment.professionalId;
        const date = updateAppointmentDto.date || appointment.date;
        const services = updateData.services || appointment.services;

        const isAvailable = await this.checkProfessionalAvailabilityForUpdate(
          professionalId,
          date,
          services,
          tenantId,
          id, // ID de la cita actual para excluirla
        );

        if (!isAvailable) {
          throw new BusinessException(
            ErrorCode.SLOT_UNAVAILABLE,
            'Horario no disponible',
            LEGACY_STATUS.SLOT_UNAVAILABLE,
          );
        }
      }

      // Primero va el objeto original, luego los datos de actualización
      const appointmentToUpdate = {
        ...appointment,
        ...updateData,
      };

      await this.appointmentRepository.save(appointmentToUpdate);

      // Para asegurar que obtenemos todos los datos relacionados
      return this.findOne(id, tenantId);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
    }
  }

  // Versión de checkProfessionalAvailability que excluye una cita específica (para updates)
  async checkProfessionalAvailabilityForUpdate(
    professionalId: string,
    appointmentDateTime: string | Date,
    services: any[],
    tenantId: string,
    excludeAppointmentId: string,
  ): Promise<boolean> {
    try {
      const appointmentDate = new Date(appointmentDateTime);

      const totalDurationMinutes = services.reduce(
        (sum, service) =>
          sum + (service.duration ? parseInt(service.duration) : 30),
        0,
      );

      const appointmentEndTime = new Date(appointmentDate);
      appointmentEndTime.setMinutes(
        appointmentEndTime.getMinutes() + totalDurationMinutes,
      );

      const startOfDay = new Date(appointmentDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(appointmentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const appointmentsForDay = await this.appointmentRepository.find({
        where: {
          professionalId,
          ownerId: tenantId,
          date: Between(startOfDay, endOfDay),
          id: Not(excludeAppointmentId), // Excluir la cita actual
        },
        relations: ['services'],
      });

      for (const existingAppointment of appointmentsForDay) {
        const existingDuration = existingAppointment.services.reduce(
          (sum, service) => sum + (service.duration || 30),
          0,
        );

        const existingStartTime = new Date(existingAppointment.date);
        const existingEndTime = new Date(existingStartTime);
        existingEndTime.setMinutes(
          existingEndTime.getMinutes() + existingDuration,
        );

        const hasOverlap =
          (appointmentDate >= existingStartTime &&
            appointmentDate < existingEndTime) ||
          (appointmentEndTime > existingStartTime &&
            appointmentEndTime <= existingEndTime) ||
          (appointmentDate <= existingStartTime &&
            appointmentEndTime >= existingEndTime);

        if (hasOverlap) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        'Error al verificar disponibilidad para actualización:',
        error?.message,
      );
      throw new InternalServerErrorException(
        'Error al verificar disponibilidad',
      );
    }
  }

  /**
   * Citas visibles para el alcance (todas las del negocio para el Owner; las
   * suyas para el Employee), opcionalmente entre dos fechas.
   */
  async findAll(
    scope: AppointmentScope,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Appointment[]> {
    try {
      const where: FindOptionsWhere<Appointment> = this.scopeWhere(scope);
      if (startDate && endDate) {
        where.date = Between(startDate, endDate);
      }

      return await this.appointmentRepository.find({
        where,
        relations: ['client', 'professional', 'services'],
        order: {
          date: 'ASC',
        },
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'las citas',
        operation: 'listar',
      });
    }
  }

  /**
   * Una cita del negocio. Acepta el `tenantId` (llamadas internas: pagos,
   * reseñas, bloques) o un `AppointmentScope` (rutas de citas). Ajena = 404.
   */
  async findOne(
    id: string,
    scope: AppointmentScope | string,
  ): Promise<Appointment> {
    const appointment = await this.appointmentRepository.findOne({
      where: { id, ...this.scopeWhere(toAppointmentScope(scope)) },
      relations: RELATION_GROUPS.default,
    });

    if (!appointment) {
      throw new NotFoundException(`Cita con ID ${id} no encontrada`);
    }

    return appointment;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    try {
      const appointment = await this.findOne(id, tenantId);
      await this.appointmentRepository.remove(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'eliminar',
      });
    }
  }

  async markReminderAsSent(
    id: string,
    scope: AppointmentScope,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id, scope);

      appointment.reminderSent = true;
      appointment.reminderSentAt = new Date();

      return await this.appointmentRepository.save(appointment);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
    }
  }
}
