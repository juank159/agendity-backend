import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  AppointmentSource,
  AppointmentStatus,
} from 'src/common/enums/status.enum';
import {
  formatBusinessLongDate,
  formatBusinessTime,
  isValidDate,
  parseBusinessDate,
} from 'src/common/utils/date.util';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { appointmentEnd } from 'src/appointments/appointment-slot';
import { Client } from 'src/clients/entities/client.entity';
import {
  Notification,
  NotificationType,
  ReceiverType,
} from 'src/notifications/entities/notification.entity';
import { SubscriptionsService } from 'src/subscriptions/services/subscriptions.service';
import { OpeningHoursRange } from 'src/settings/opening-hours';
import { TenantSettingsService } from 'src/settings/tenant-settings.service';
import {
  CreatePublicBookingDto,
  PublicBookingClientDto,
  PublicSlotsQueryDto,
} from './dto/public-booking.dto';
import {
  orderForAnyProfessional,
  phoneDigits,
  PUBLIC_BOOKING_LIMITS,
  unionOfStarts,
} from './public-booking-rules';

/** Negocio resuelto por su slug. */
export interface PublicBusiness {
  tenantId: string;
  name: string | null;
  slug: string;
  timezone: string;
  openingHours: OpeningHoursRange[] | null;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  duration: number;
  price: number;
  color: string;
  category: string | null;
}

export interface Candidate {
  id: string;
  name: string;
  image: string | null;
}

const UNAVAILABLE_MESSAGE =
  'Este negocio no está recibiendo reservas en línea en este momento';

/** Errores de hueco: con "cualquiera" se prueba el siguiente profesional. */
const SLOT_ERRORS = new Set<string>([
  ErrorCode.SLOT_UNAVAILABLE,
  ErrorCode.OUTSIDE_BUSINESS_HOURS,
]);

/**
 * Reserva pública por el link del negocio (9.01, D-17). Sin sesión: el negocio
 * sale del `slug` y nada de lo que responde lleva datos de otros clientes ni
 * ids que la web no necesite (solo los de servicios y profesionales, para
 * reservar). Las reglas de la cita son las MISMAS que en la app: usa
 * `AppointmentsService` (horas libres, lock, cupo del trial, horario del
 * negocio y del profesional, solo a futuro).
 */
@Injectable()
export class PublicBookingService {
  private readonly logger = new Logger(PublicBookingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly appointments: AppointmentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly settings: TenantSettingsService,
  ) {}

  /** Negocio por slug (dueño no dado de baja); si no, 404. */
  async resolveBusiness(slug: string): Promise<PublicBusiness> {
    const [row] = await this.dataSource.query(
      `SELECT bs.tenant_id AS "tenantId", bs.slug
         FROM business_settings bs
         JOIN users u ON u.id = bs.tenant_id AND u."deletedAt" IS NULL
        WHERE bs.slug = $1`,
      [String(slug ?? '').toLowerCase()],
    );
    if (!row) throw new NotFoundException('Negocio no encontrado');
    const view = await this.settings.getCachedSettings(row.tenantId);
    return {
      tenantId: row.tenantId,
      name: view.name,
      slug: row.slug,
      timezone: view.timezone,
      openingHours: view.opening_hours,
    };
  }

  /** ¿Puede el negocio recibir citas ahora (trial con cupo o plan vigente)? Solo lee. */
  async acceptsBookings(tenantId: string): Promise<boolean> {
    const allowance =
      await this.subscriptions.checkSubscriptionStatus(tenantId);
    return allowance.canCreateAppointment;
  }

  private async assertAcceptsBookings(tenantId: string): Promise<void> {
    if (!(await this.acceptsBookings(tenantId))) {
      throw new BusinessException(
        ErrorCode.ONLINE_BOOKING_UNAVAILABLE,
        UNAVAILABLE_MESSAGE,
      );
    }
  }

  /** `GET /public/businesses/:slug`. */
  async businessInfo(business: PublicBusiness) {
    return {
      name: business.name,
      slug: business.slug,
      timezone: business.timezone,
      opening_hours: business.openingHours,
      accepting_bookings: await this.acceptsBookings(business.tenantId),
    };
  }

  /** `GET …/services`: activos y con reserva en línea, agrupados por categoría. */
  async services(business: PublicBusiness) {
    const services = await this.loadServices(business.tenantId);
    const groups = new Map<string, Omit<PublicService, 'category'>[]>();
    for (const { category, ...service } of services) {
      const key = category ?? 'Otros';
      groups.set(key, [...(groups.get(key) ?? []), service]);
    }
    return [...groups.entries()].map(([category, items]) => ({
      category,
      services: items,
    }));
  }

  /** `GET …/professionals`: los que hacen TODOS los servicios elegidos. */
  async professionals(business: PublicBusiness, serviceIds: string[]) {
    await this.requireServices(business.tenantId, serviceIds);
    const candidates = await this.candidates(business.tenantId, serviceIds);
    return candidates.map(({ id, name, image }) => ({ id, name, image }));
  }

  /**
   * `GET …/available-slots`: inicios libres del día para los servicios (con un
   * profesional, o la unión de todos los que los hacen = "cualquiera").
   */
  async availableSlots(business: PublicBusiness, query: PublicSlotsQueryDto) {
    await this.assertAcceptsBookings(business.tenantId);
    const services = await this.requireServices(
      business.tenantId,
      query.service_ids,
    );
    const professionals = await this.chosenCandidates(
      business.tenantId,
      query.service_ids,
      query.professional_id,
    );
    const lists = await Promise.all(
      professionals.map((professional) =>
        this.appointments.findAvailableSlots(
          {
            professionalId: professional.id,
            date: query.date,
            serviceIds: query.service_ids,
            stepMinutes: query.step ?? 15,
          },
          business.tenantId,
        ),
      ),
    );
    return {
      date: query.date,
      timezone: business.timezone,
      duration_minutes: services.reduce((sum, s) => sum + s.duration, 0),
      slots: unionOfStarts(lists),
    };
  }

  /**
   * `POST …/bookings`: crea la cita `PENDING`, origen `WEB`. Con "cualquiera"
   * prueba los profesionales en orden determinista (`orderForAnyProfessional`)
   * hasta que uno tenga el hueco libre. El cliente se busca por (teléfono,
   * negocio) o se crea, dentro de la transacción de la cita (con el lock del
   * negocio: el límite por teléfono no se puede saltar en paralelo).
   */
  async createBooking(business: PublicBusiness, dto: CreatePublicBookingDto) {
    if (dto.website) {
      this.logger.warn(`Reserva descartada por el honeypot (${business.slug})`);
      throw new BadRequestException('Solicitud inválida');
    }
    await this.assertAcceptsBookings(business.tenantId);
    const services = await this.requireServices(
      business.tenantId,
      dto.service_ids,
    );
    let candidates = await this.chosenCandidates(
      business.tenantId,
      dto.service_ids,
      dto.professional_id ?? undefined,
    );
    if (!dto.professional_id) {
      candidates = await this.byLoad(business, candidates, dto.start);
    }

    let lastSlotError: unknown;
    for (const professional of candidates) {
      try {
        const appointment = await this.appointments.create(
          {
            client_id: '',
            professional_id: professional.id,
            service_ids: dto.service_ids,
            date: dto.start,
            notes: dto.notes ?? '',
          } as never,
          business.tenantId,
          {
            source: AppointmentSource.WEB,
            resolveClient: (manager) =>
              this.findOrCreateClient(manager, business.tenantId, dto.client),
          },
        );
        await this.notifyBusiness(
          business,
          appointment,
          professional,
          services,
        );
        return this.bookingResponse(
          business,
          appointment,
          professional,
          services,
        );
      } catch (error) {
        const code = (error as HttpException)?.getResponse?.()?.['code'];
        if (
          code === ErrorCode.TRIAL_LIMIT_REACHED ||
          code === ErrorCode.SUBSCRIPTION_INACTIVE
        ) {
          throw new BusinessException(
            ErrorCode.ONLINE_BOOKING_UNAVAILABLE,
            UNAVAILABLE_MESSAGE,
          );
        }
        if (SLOT_ERRORS.has(code)) {
          lastSlotError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastSlotError;
  }

  /** Servicios del negocio activos y con reserva en línea (con su categoría). */
  private async loadServices(
    tenantId: string,
    ids?: string[],
  ): Promise<PublicService[]> {
    const rows = await this.dataSource.query(
      `SELECT s.id, s.name, s.description, s.duration, s.price::float AS price,
              s.color, c.name AS category
         FROM services s
         LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.owner_id = $1 AND s."isActive" AND s."onlineBooking"
          AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
        ORDER BY c.name NULLS LAST, s.name`,
      [tenantId, ids ?? null],
    );
    return rows.map((row: PublicService) => ({
      ...row,
      duration: Number(row.duration),
      price: Number(row.price),
    }));
  }

  /** Todos los servicios pedidos deben ser públicos del negocio; si no, 404. */
  private async requireServices(
    tenantId: string,
    ids: string[],
  ): Promise<PublicService[]> {
    const services = await this.loadServices(tenantId, ids);
    if (services.length !== new Set(ids).size) {
      throw new NotFoundException('Uno o más servicios no están disponibles');
    }
    return ids.map((id) => services.find((s) => s.id === id) as PublicService);
  }

  /**
   * Profesionales que se pueden reservar para TODOS los servicios: empleados
   * activos y verificados con cada servicio asignado y activo, y el Owner solo
   * si atiende (tiene horario propio). Orden por nombre.
   */
  private async candidates(
    tenantId: string,
    serviceIds: string[],
  ): Promise<Candidate[]> {
    return this.dataSource.query(
      `SELECT u.id, u.name, u.image
         FROM users u
        WHERE u."deletedAt" IS NULL AND u."isActive"
          AND (
            (u.id = $1 AND EXISTS (SELECT 1 FROM schedules s WHERE s."userId" = u.id))
            OR (
              u.owner_id = $1 AND u.is_email_verified
              AND (SELECT count(DISTINCT us.service_id) FROM user_services us
                    WHERE us.user_id = u.id AND us."isActive"
                      AND us.service_id = ANY($2::uuid[])) = cardinality($2::uuid[])
            )
          )
        ORDER BY u.name, u.id`,
      [tenantId, serviceIds],
    );
  }

  /** El profesional elegido (debe ser candidato; si no, 404) o todos. */
  private async chosenCandidates(
    tenantId: string,
    serviceIds: string[],
    professionalId: string | undefined,
  ): Promise<Candidate[]> {
    const all = await this.candidates(tenantId, serviceIds);
    const chosen = professionalId
      ? all.filter((c) => c.id === professionalId)
      : all;
    if (!chosen.length) {
      throw new NotFoundException(
        professionalId
          ? 'El profesional no está disponible para estos servicios'
          : 'No hay profesionales disponibles para estos servicios',
      );
    }
    return chosen;
  }

  /** "Cualquiera": ordena por citas de ese día (menos primero), luego nombre e id. */
  private async byLoad(
    business: PublicBusiness,
    candidates: Candidate[],
    start: string,
  ): Promise<Candidate[]> {
    const rows: { professional_id: string; load: number }[] =
      await this.dataSource.query(
        `SELECT a.professional_id, count(*)::int AS load
           FROM appointments a
          WHERE a.owner_id = $1 AND a.status <> 'CANCELLED'
            AND a.professional_id = ANY($2::uuid[])
            AND (a."date" AT TIME ZONE $3)::date = (($4::timestamptz) AT TIME ZONE $3)::date
          GROUP BY a.professional_id`,
        [
          business.tenantId,
          candidates.map((c) => c.id),
          business.timezone,
          this.safeInstant(start, business.timezone),
        ],
      );
    const load = new Map(rows.map((r) => [r.professional_id, r.load]));
    return orderForAnyProfessional(
      candidates.map((c) => ({ ...c, load: load.get(c.id) ?? 0 })),
    );
  }

  /** Instante del inicio pedido en la zona del negocio (para agrupar por día); inválido → ahora. */
  private safeInstant(start: string, timeZone: string): Date {
    const date = parseBusinessDate(start, timeZone);
    return isValidDate(date) ? date : new Date();
  }

  /**
   * Cliente por (teléfono, negocio), comparando solo dígitos; si no existe se
   * crea. Si existe, NO se cambian sus datos. Un email que ya usa otro
   * cliente del negocio no se guarda (no se revela que existe). Antes, el
   * límite de reservas `PENDING` a futuro de ese teléfono.
   */
  private async findOrCreateClient(
    manager: EntityManager,
    tenantId: string,
    data: PublicBookingClientDto,
  ): Promise<Client> {
    const digits = phoneDigits(data.phone);
    const [{ pending }] = await manager.query(
      `SELECT count(*)::int AS pending
         FROM appointments a
         JOIN clients c ON c.id = a."clientId"
        WHERE a.owner_id = $1 AND c.owner_id = $1
          AND regexp_replace(c.phone, '\\D', '', 'g') = $2
          AND a.status = $3 AND a."date" > now()`,
      [tenantId, digits, AppointmentStatus.PENDING],
    );
    if (pending >= PUBLIC_BOOKING_LIMITS.maxPendingPerPhone) {
      throw new BusinessException(
        ErrorCode.BOOKING_LIMIT_REACHED,
        `Ya tienes ${PUBLIC_BOOKING_LIMITS.maxPendingPerPhone} reservas pendientes en este negocio. Espera a que te confirmen o comunícate con el negocio.`,
      );
    }

    const [existing] = await manager.query(
      `SELECT id FROM clients
        WHERE owner_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2
        ORDER BY created_at LIMIT 1`,
      [tenantId, digits],
    );
    const clients = manager.getRepository(Client);
    if (existing) {
      return clients.findOneByOrFail({ id: existing.id });
    }
    const email = data.email?.toLowerCase() ?? null;
    const emailTaken =
      !!email && (await clients.exist({ where: { ownerId: tenantId, email } }));
    return clients.save(
      clients.create({
        ownerId: tenantId,
        name: data.name,
        lastname: data.lastname ?? '',
        phone: data.phone,
        email: emailTaken ? null : email,
        isFromDevice: false,
        isActive: true,
        showNotes: false,
      }),
    );
  }

  /** Aviso interno al Owner y al profesional (si es otro). No rompe la reserva. */
  private async notifyBusiness(
    business: PublicBusiness,
    appointment: { id: string; date: Date; client?: Client | null },
    professional: Candidate,
    services: PublicService[],
  ): Promise<void> {
    try {
      const client = appointment.client;
      const who =
        [client?.name, client?.lastname].filter(Boolean).join(' ') ||
        'Un cliente';
      const when = `${formatBusinessLongDate(appointment.date, business.timezone)} a las ${formatBusinessTime(appointment.date, business.timezone)}`;
      const message = `${who} reservó en línea ${services
        .map((s) => s.name)
        .join(
          ', ',
        )} con ${professional.name} el ${when}. Está pendiente de confirmar.`;
      const repo = this.dataSource.getRepository(Notification);
      const receivers = [...new Set([business.tenantId, professional.id])];
      await repo.save(
        receivers.map((receiverId) =>
          repo.create({
            receiver_id: receiverId,
            receiver_type: ReceiverType.USER,
            type: NotificationType.GENERAL,
            title: 'Nueva reserva en línea',
            message,
            metadata: {
              kind: 'ONLINE_BOOKING',
              appointment_id: appointment.id,
              client_id: client?.id ?? null,
            },
          }),
        ),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar de la reserva ${appointment.id}: ${error?.message}`,
      );
    }
  }

  /** Respuesta pública: sin ids internos de la cita ni del cliente. */
  private bookingResponse(
    business: PublicBusiness,
    appointment: { date: Date; total_price: number | string },
    professional: Candidate,
    services: PublicService[],
  ) {
    return {
      status: AppointmentStatus.PENDING,
      timezone: business.timezone,
      start: appointment.date,
      end: appointmentEnd(appointment.date, services),
      professional: { name: professional.name },
      services: services.map(({ name, duration, price }) => ({
        name,
        duration,
        price,
      })),
      total_price: Number(appointment.total_price),
      business: { name: business.name },
    };
  }
}
