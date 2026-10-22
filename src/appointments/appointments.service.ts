import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  HttpException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  FindOptionsWhere,
  DataSource,
  EntityManager,
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
import {
  appointmentDurationSql,
  appointmentEnd,
  blocksSlot,
  fitsSchedule,
  NON_BLOCKING_STATUSES,
} from './appointment-slot';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

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
   * y servicios deben ser del mismo negocio (si no, 404) y el profesional debe
   * estar activo; todo se valida antes de tocar la suscripción. Después, en UNA
   * transacción: se consume el cupo (trial o plan, con lock por negocio), se
   * comprueba el hueco con lock por profesional (`assertSlotAvailable`) y se
   * guarda. Si algo falla, el rollback devuelve la cita al cupo.
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
      this.assertProfessionalSchedulable(professional);

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
          // Orden de locks: negocio (cupo) → profesional (hueco). `update` solo
          // toma el del profesional, así que no hay ciclo (sin deadlock).
          await this.subscriptionsService.consumeAppointmentQuota(
            tenantId,
            manager,
          );

          await this.assertSlotAvailable(manager, {
            tenantId,
            professionalId: professional_id,
            start: appointmentToSave.date,
            services,
          });

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

  /** Un profesional desactivado (o borrado) no recibe citas nuevas ni movidas. */
  private assertProfessionalSchedulable(professional: User): void {
    if (!professional?.isActive || professional.deletedAt) {
      throw new BusinessException(
        ErrorCode.PROFESSIONAL_INACTIVE,
        'El profesional no está activo y no puede recibir citas',
        LEGACY_STATUS.PROFESSIONAL_INACTIVE,
      );
    }
  }

  /**
   * Regla única de disponibilidad (crear y mover/editar). Debe llamarse DENTRO
   * de la transacción que guarda la cita:
   * 1. Lock por profesional (`pg_advisory_xact_lock`) hasta el commit: dos
   *    peticiones para el mismo profesional se serializan y la segunda ya ve la
   *    cita de la primera (READ COMMITTED toma foto nueva por sentencia).
   * 2. Horario del profesional (`schedules`) de ese día de la semana.
   * 3. Bloqueos (`time_block`) que se crucen con el hueco.
   * 4. Otras citas del profesional que se crucen, salvo las `CANCELLED` y la
   *    propia (`excludeAppointmentId`, al editar).
   * Intervalos semiabiertos [inicio, fin): una cita puede empezar justo cuando
   * termina otra. Cualquier fallo → `SLOT_UNAVAILABLE` "Horario no disponible"
   * (la app muestra su diálogo comparando ese texto; HTTP 400 legado, D-11).
   */
  async assertSlotAvailable(
    manager: EntityManager,
    slot: {
      tenantId: string;
      professionalId: string;
      start: Date;
      services: { duration?: number | string | null }[];
      excludeAppointmentId?: string;
    },
  ): Promise<void> {
    const { tenantId, professionalId, start, services } = slot;
    const exclude = slot.excludeAppointmentId ?? null;
    if (!tenantId || !professionalId) {
      // TypeORM ignora `undefined` en el where: nunca consultar sin ellos.
      throw new NotFoundException('Profesional no encontrado');
    }
    if (!(start instanceof Date) || isNaN(start.getTime())) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Fecha de cita inválida',
      );
    }
    const end = appointmentEnd(start, services);

    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`appointment-slot:${professionalId}`],
    );

    const schedules = await manager.getRepository(Schedule).find({
      where: { user: { id: professionalId } },
    });
    if (!fitsSchedule(start, end, schedules)) {
      this.slotUnavailable('fuera del horario del profesional');
    }

    // Fechas como `Date`: node-postgres las manda en hora local y Postgres,
    // al compararlas con un `timestamp` sin zona, usa esa hora local (2.05).
    const blocks = await manager.query(
      `SELECT 1 FROM time_block tb
        WHERE tb."userId" = $1
          AND tb.start_datetime < $2
          AND tb.end_datetime > $3
          AND ($4::uuid IS NULL OR tb."appointmentId" IS DISTINCT FROM $4::uuid)
        LIMIT 1`,
      [professionalId, end, start, exclude],
    );
    if (blocks.length) this.slotUnavailable('bloqueo de tiempo');

    const overlapping = await manager.query(
      `SELECT a.id
         FROM appointments a
         LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
         LEFT JOIN services s ON s.id = aps.service_id
        WHERE a.professional_id = $1
          AND a.owner_id = $2
          AND NOT (a.status = ANY($3::appointments_status_enum[]))
          AND a.date < $4
          AND ($6::uuid IS NULL OR a.id <> $6::uuid)
        GROUP BY a.id
       HAVING a.date + make_interval(mins => (${appointmentDurationSql('s')})::int) > $5
        LIMIT 1`,
      [professionalId, tenantId, NON_BLOCKING_STATUSES, end, start, exclude],
    );
    if (overlapping.length) this.slotUnavailable('cruce con otra cita');
  }

  private slotUnavailable(reason: string): never {
    this.logger.debug(`Horario no disponible: ${reason}`);
    throw new BusinessException(
      ErrorCode.SLOT_UNAVAILABLE,
      'Horario no disponible',
      LEGACY_STATUS.SLOT_UNAVAILABLE,
    );
  }

  /**
   * Edita una cita del negocio. Si cambia el hueco (fecha, profesional o
   * servicios) o se reactiva una cita cancelada, se aplica la misma regla y el
   * mismo lock que al crear (`assertSlotAvailable`), excluyendo la propia cita,
   * en la misma transacción que guarda.
   */
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

      const nextStatus: AppointmentStatus =
        updateData.status ?? appointment.status;
      const slotChanged = !!(
        updateAppointmentDto.professional_id ||
        updateAppointmentDto.date ||
        updateAppointmentDto.service_ids
      );
      const reactivated =
        !blocksSlot(appointment.status) && blocksSlot(nextStatus);
      const mustCheckSlot =
        blocksSlot(nextStatus) && (slotChanged || reactivated);

      const professionalId =
        updateAppointmentDto.professional_id || appointment.professionalId;
      if (mustCheckSlot) {
        // Recarga el profesional: si se borró (soft-delete) → 404; inactivo → error.
        const professional =
          updateData.professional ??
          (await this.usersService.findTenantMember(professionalId, tenantId));
        this.assertProfessionalSchedulable(professional);
      }

      // Primero va el objeto original, luego los datos de actualización
      const appointmentToUpdate = {
        ...appointment,
        ...updateData,
      };

      await this.dataSource.transaction(async (manager) => {
        if (mustCheckSlot) {
          await this.assertSlotAvailable(manager, {
            tenantId,
            professionalId,
            start: new Date(updateData.date ?? appointment.date),
            services: updateData.services ?? appointment.services,
            excludeAppointmentId: id,
          });
        }
        await manager.getRepository(Appointment).save(appointmentToUpdate);
      });

      // Para asegurar que obtenemos todos los datos relacionados
      return this.findOne(id, tenantId);
    } catch (error) {
      this.handleError(error, {
        entity: 'la cita',
        operation: 'actualizar',
      });
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
