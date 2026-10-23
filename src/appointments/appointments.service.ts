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
import {
  assertCancellable,
  assertTransition,
  statusAfterPayment,
} from './appointment-status';
import { Payment } from 'src/payments/entities/payment.entity';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { User } from 'src/users/entities/user.entity';
import { parseBusinessDate } from 'src/common/utils/date.util';

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
   * Crea una cita del negocio (Owner: para cualquier profesional del negocio;
   * Employee: solo para sí mismo, si no 403 FORBIDDEN, 2.15). Cliente, profesional
   * y servicios deben ser del mismo negocio (si no, 404) y el profesional debe
   * estar activo; todo se valida antes de tocar la suscripción. Después, en UNA
   * transacción: se consume el cupo (trial o plan, con lock por negocio), se
   * comprueba el hueco con lock por profesional (`assertSlotAvailable`) y se
   * guarda. Si algo falla, el rollback devuelve la cita al cupo.
   */
  async create(
    createAppointmentDto: CreateAppointmentDto,
    scope: AppointmentScope | string,
  ): Promise<Appointment> {
    try {
      const { tenantId, professionalId: ownProfessionalId } =
        toAppointmentScope(scope);
      const {
        client_id,
        professional_id,
        service_ids,
        date,
        ...appointmentData
      } = createAppointmentDto;

      // Regla del usuario (2.15): un Employee agenda solo para sí mismo.
      if (ownProfessionalId && professional_id !== ownProfessionalId) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          'Solo puedes agendar citas para ti',
        );
      }

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
        date: parseBusinessDate(date),
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

    await this.lockProfessionalSlot(manager, professionalId);

    const schedules = await manager.getRepository(Schedule).find({
      where: { user: { id: professionalId } },
    });
    if (!fitsSchedule(start, end, schedules)) {
      this.slotUnavailable('fuera del horario del profesional');
    }

    // Fechas como `Date` (instantes) contra columnas `timestamptz` (2.05).
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

    if (
      await this.hasOverlappingAppointment(manager, {
        tenantId,
        professionalId,
        start,
        end,
        excludeAppointmentId: exclude,
      })
    ) {
      this.slotUnavailable('cruce con otra cita');
    }
  }

  /**
   * Lock del hueco de un profesional hasta el fin de la transacción
   * (`pg_advisory_xact_lock`). Lo toman todas las escrituras que deciden si un
   * hueco está libre: citas (`assertSlotAvailable`) y bloqueos de tiempo
   * (`assertNoAppointmentOverlap`), así no se cruzan en paralelo.
   */
  async lockProfessionalSlot(
    manager: EntityManager,
    professionalId: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`appointment-slot:${professionalId}`],
    );
  }

  /**
   * ¿Alguna cita del profesional que ocupe hueco (no `CANCELLED`) se cruza con
   * [start, end)? Fin de cada cita con `appointmentDurationSql` (misma regla que
   * `appointmentEnd`). Llamar con el lock del profesional tomado.
   */
  private async hasOverlappingAppointment(
    manager: EntityManager,
    range: {
      tenantId: string;
      professionalId: string;
      start: Date;
      end: Date;
      excludeAppointmentId?: string | null;
    },
  ): Promise<boolean> {
    const { tenantId, professionalId, start, end } = range;
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
      [
        professionalId,
        tenantId,
        NON_BLOCKING_STATUSES,
        end,
        start,
        range.excludeAppointmentId ?? null,
      ],
    );
    return overlapping.length > 0;
  }

  /**
   * Regla de los bloqueos de tiempo (2.08, la más conservadora): un bloqueo no
   * puede cruzarse con una cita que ocupe hueco (no `CANCELLED`) del mismo
   * profesional, salvo la cita a la que el bloqueo está ligado
   * (`excludeAppointmentId`). Toma el mismo lock que las citas: llamar DENTRO de
   * la transacción que guarda el bloqueo. Falla con el mismo error que una cita
   * (`SLOT_UNAVAILABLE` "Horario no disponible", HTTP 400 legado).
   */
  async assertNoAppointmentOverlap(
    manager: EntityManager,
    range: {
      tenantId: string;
      professionalId: string;
      start: Date;
      end: Date;
      excludeAppointmentId?: string | null;
    },
  ): Promise<void> {
    if (!range.tenantId || !range.professionalId) {
      throw new NotFoundException('Profesional no encontrado');
    }
    await this.lockProfessionalSlot(manager, range.professionalId);
    if (await this.hasOverlappingAppointment(manager, range)) {
      this.slotUnavailable('bloqueo encima de una cita');
    }
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
   * Edita una cita del negocio (PATCH genérico, solo Owner). Si cambia el hueco
   * (fecha, profesional o servicios) se aplica la misma regla y el mismo lock
   * que al crear (`assertSlotAvailable`), excluyendo la propia cita. Un cambio
   * de `status` pasa por la máquina de estados (`appointment-status.ts`) contra
   * el estado leído CON lock de fila dentro de la transacción (2.06): una
   * cancelación y un pago simultáneos no se pisan. Solo se escriben los campos
   * que cambian (nunca la foto vieja de la cita entera).
   */
  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    tenantId: string,
  ): Promise<Appointment> {
    try {
      const appointment = await this.findOne(id, tenantId);

      // Solo los campos que cambian (save parcial por id).
      const updateData: Partial<Appointment> & { id: string } = { id };

      if (updateAppointmentDto.date)
        updateData.date = parseBusinessDate(updateAppointmentDto.date);
      if (updateAppointmentDto.notes !== undefined)
        updateData.notes = updateAppointmentDto.notes;

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

      const slotChanged = !!(
        updateAppointmentDto.professional_id ||
        updateAppointmentDto.date ||
        updateAppointmentDto.service_ids
      );
      const professionalId =
        updateAppointmentDto.professional_id || appointment.professionalId;

      await this.dataSource.transaction(async (manager) => {
        const current = await this.lockAppointment(manager, id, tenantId);

        let nextStatus = current.status;
        if (updateAppointmentDto.status) {
          if (assertTransition(current.status, updateAppointmentDto.status)) {
            nextStatus = updateAppointmentDto.status;
            updateData.status = nextStatus;
            if (nextStatus === AppointmentStatus.CANCELLED) {
              await this.assertCancellable(manager, id);
              updateData.cancellation_reason =
                updateAppointmentDto.cancellation_reason ?? null;
            }
          }
        }

        // Una cita CANCELLED no ocupa hueco: moverla no se comprueba. Como
        // CANCELLED es final, ya no hay "reactivar" (2.06).
        if (blocksSlot(nextStatus) && slotChanged) {
          // Recarga el profesional: si se borró (soft-delete) → 404; inactivo → error.
          const professional =
            updateData.professional ??
            (await this.usersService.findTenantMember(
              professionalId,
              tenantId,
            ));
          this.assertProfessionalSchedulable(professional);
          await this.assertSlotAvailable(manager, {
            tenantId,
            professionalId,
            start: new Date(updateData.date ?? appointment.date),
            services: updateData.services ?? appointment.services,
            excludeAppointmentId: id,
          });
        }
        await manager.getRepository(Appointment).save(updateData);
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
   * Lee la cita (sin relaciones) con `SELECT … FOR UPDATE` dentro de la
   * transacción `manager`: serializa los cambios de estado, los pagos y los
   * reembolsos de la misma cita hasta el commit. Ajena o inexistente = 404.
   * Orden de locks: fila de la cita → (pago) / (profesional, al mover).
   */
  async lockAppointment(
    manager: EntityManager,
    id: string,
    scope: AppointmentScope | string,
  ): Promise<Appointment> {
    const appointment = await manager.getRepository(Appointment).findOne({
      where: { id, ...this.scopeWhere(toAppointmentScope(scope)) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!appointment) {
      throw new NotFoundException(`Cita con ID ${id} no encontrada`);
    }
    return appointment;
  }

  /**
   * Cancela una cita (PENDING o CONFIRMED → CANCELLED) con motivo opcional,
   * salvo que tenga un pago COMPLETED (`APPOINTMENT_PAID`, 2.15).
   * Owner: cualquier cita del negocio; Employee: solo las suyas (alcance).
   * El hueco queda libre (`blocksSlot`). El cupo del trial NO se devuelve.
   */
  cancel(
    id: string,
    scope: AppointmentScope,
    cancellationReason?: string,
  ): Promise<Appointment> {
    return this.changeStatus(id, scope, AppointmentStatus.CANCELLED, {
      cancellation_reason: cancellationReason?.trim() || null,
    });
  }

  /** Completa una cita PENDING o CONFIRMED (→ COMPLETED; sin pagar se paga después, 2.15). */
  complete(id: string, scope: AppointmentScope): Promise<Appointment> {
    return this.changeStatus(id, scope, AppointmentStatus.COMPLETED);
  }

  private async changeStatus(
    id: string,
    scope: AppointmentScope,
    to: AppointmentStatus,
    extra: Partial<Appointment> = {},
  ): Promise<Appointment> {
    await this.dataSource.transaction(async (manager) => {
      const current = await this.lockAppointment(manager, id, scope);
      if (!assertTransition(current.status, to)) return; // ya estaba: no-op
      if (to === AppointmentStatus.CANCELLED) {
        await this.assertCancellable(manager, current.id);
      }
      await manager
        .getRepository(Appointment)
        .update({ id: current.id }, { status: to, ...extra });
    });
    return this.findOne(id, scope);
  }

  /**
   * Una cita con un pago COMPLETED no se cancela (2.15). Se consulta con la
   * cita ya bloqueada: crear un pago bloquea la misma fila, así que un pago y
   * una cancelación simultáneos no pueden pasar los dos.
   */
  private async assertCancellable(
    manager: EntityManager,
    appointmentId: string,
  ): Promise<void> {
    const paid = await manager.getRepository(Payment).exist({
      where: {
        appointment: { id: appointmentId },
        status: PaymentStatus.COMPLETED,
      },
    });
    assertCancellable(paid);
  }

  /**
   * Efecto de un pago sobre la cita, dentro de la transacción del pago y con
   * la cita ya bloqueada (`lockAppointment`): PENDING → CONFIRMED (máquina de
   * estados) y `payment_status` según el pago.
   */
  async applyPaymentStatus(
    manager: EntityManager,
    locked: Appointment,
    paymentStatus: PaymentStatus,
  ): Promise<void> {
    const changes: Partial<Appointment> = { payment_status: paymentStatus };
    if (paymentStatus === PaymentStatus.COMPLETED) {
      changes.status = statusAfterPayment(locked.status);
    }
    await manager.getRepository(Appointment).update({ id: locked.id }, changes);
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
