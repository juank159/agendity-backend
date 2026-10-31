import { HttpException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { AuthUser, isOnlyEmployee } from 'src/auth/interfaces';
import { tenantIdFrom } from 'src/common/decorators/tenant.decorator';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { appointmentScopeOf } from 'src/appointments/appointment-scope';
import { CancelAppointmentDto } from 'src/appointments/dto/cancel-appointment.dto';
import { CreateAppointmentDto } from 'src/appointments/dto/create-appointment.dto';
import { UpdateAppointmentDto } from 'src/appointments/dto/update-appointment.dto';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { CategoriesService } from 'src/categories/categories.service';
import { CreateCategoryDto } from 'src/categories/dto/create-category.dto';
import { UpdateCategoryDto } from 'src/categories/dto/update-category.dto';
import { Category } from 'src/categories/entities/category.entity';
import { ClientsService } from 'src/clients/clients.service';
import { CreateClientDto } from 'src/clients/dto/create-client.dto';
import { UpdateClientDto } from 'src/clients/dto/update-client.dto';
import { Client } from 'src/clients/entities/client.entity';
import { ErrorCode } from 'src/common/constants/error-codes';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { CreatePaymentDto } from 'src/payments/dto/create-payment.dto';
import { RefundPaymentDto } from 'src/payments/dto/refund-payment.dto';
import { Payment } from 'src/payments/entities/payment.entity';
import { PaymentsService } from 'src/payments/payments.service';
import { CreateServiceDto } from 'src/services/dto/create-service.dto';
import { UpdateServiceDto } from 'src/services/dto/update-service.dto';
import { Service } from 'src/services/entities/service.entity';
import { ServicesService } from 'src/services/services.service';
import { CreateTimeBlockDto } from 'src/time-blocks/dto/create-time-block.dto';
import { UpdateTimeBlockDto } from 'src/time-blocks/dto/update-time-block.dto';
import { TimeBlock } from 'src/time-blocks/entities/time-block.entity';
import { TimeBlocksService } from 'src/time-blocks/time-blocks.service';
import {
  SyncMutationDto,
  SyncMutationType,
  SyncPushDto,
} from './dto/sync-push.dto';

/** Resultado de una mutación (lo que guarda `sync_mutations.result`). */
export interface SyncMutationResult {
  mutation_id: string;
  /**
   * `applied`: aplicada. `conflict`: guardada o no aplicada por un conflicto
   * visible (ver `code`; `saved: true` = el registro existe y hay que
   * revisarlo). `rejected`: dato inválido o no permitido; la app la deja en su
   * bandeja. `merged`: el cliente ya existía con ese teléfono; ver
   * `merged_into`. `retry`: error temporal, reenviarla igual (no se guardó).
   */
  status: 'applied' | 'conflict' | 'rejected' | 'merged' | 'retry';
  entity_id?: string | null;
  code?: string;
  message?: string;
  saved?: boolean;
  merged_into?: string;
}

/** Límites de la hora del dispositivo (decisión del orquestador). */
export const CLIENT_TIME_WINDOW = {
  pastMs: 30 * 24 * 3_600_000,
  futureMs: 5 * 60_000,
} as const;

/** Rechazos que dependen del estado del negocio y no se guardan (§4). */
const TRANSIENT_REJECTIONS = new Set<string>([
  ErrorCode.TRIAL_LIMIT_REACHED,
  ErrorCode.SUBSCRIPTION_INACTIVE,
]);

/** Errores que se guardan como conflicto visible (§4 del diseño). */
const CONFLICT_CODES = new Set<string>([
  ErrorCode.NOT_FOUND,
  ErrorCode.INVALID_STATE_TRANSITION,
  ErrorCode.DUPLICATE_PHONE,
  ErrorCode.DUPLICATE_EMAIL,
  ErrorCode.APPOINTMENT_PAID,
]);

type Class<T = unknown> = new () => T;

interface Context {
  user: AuthUser;
  tenantId: string;
  now: Date;
  entityId: string | undefined;
}

interface Handler {
  /** DTO de la ruta online (valida `payload` igual que ella). */
  dto?: Class;
  /** Roles: `owner` = solo Owner (como la ruta online). */
  owner?: boolean;
  /** Necesita `entity_id`. */
  needsEntity?: boolean;
  /** Crear: si ya existe ese id en el negocio, ya se aplicó (idempotente). */
  creates?: EntityTarget<ObjectLiteral>;
  /** Borrar: si ya no existe, el resultado deseado ya se cumplió. */
  deletes?: boolean;
  run(ctx: Context, payload: any): Promise<Partial<SyncMutationResult>>;
}

/**
 * Subida de cambios hechos sin conexión (10.01b, D-18). Cada mutación es una
 * operación de negocio que pasa por el MISMO service que la ruta online (lock,
 * cupo, horarios, solo a futuro con la hora del dispositivo) y, en vez de
 * fallar, guarda los conflictos de §4 a la vista. Idempotente por
 * `mutation_id` (`sync_mutations`).
 */
@Injectable()
export class SyncPushService {
  private readonly logger = new Logger(SyncPushService.name);
  private readonly errors = new AllExceptionsFilter();
  private readonly handlers: Record<SyncMutationType, Handler>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly clients: ClientsService,
    private readonly appointments: AppointmentsService,
    private readonly payments: PaymentsService,
    private readonly timeBlocks: TimeBlocksService,
    private readonly services: ServicesService,
    private readonly categories: CategoriesService,
  ) {
    const scope = (ctx: Context) => appointmentScopeOf(ctx.user);
    this.handlers = {
      'client.create': {
        dto: CreateClientDto,
        creates: Client,
        needsEntity: true,
        run: (ctx, payload: CreateClientDto) =>
          this.createClient(ctx, payload, false),
      },
      // Contacto importado del teléfono sin conexión: como una fila de
      // `POST /clients/batch` (mismo DTO y permisos), marcado `isFromDevice`.
      'client.import': {
        dto: CreateClientDto,
        creates: Client,
        needsEntity: true,
        run: (ctx, payload: CreateClientDto) =>
          this.createClient(ctx, payload, true),
      },
      'client.update': {
        dto: UpdateClientDto,
        needsEntity: true,
        run: async (ctx, payload) => {
          await this.clients.update(ctx.entityId!, payload, ctx.tenantId);
          return {};
        },
      },
      'client.delete': {
        owner: true,
        needsEntity: true,
        deletes: true,
        run: async (ctx) => {
          await this.clients.remove(ctx.entityId!, ctx.tenantId);
          return {};
        },
      },
      'appointment.create': {
        dto: CreateAppointmentDto,
        creates: Appointment,
        needsEntity: true,
        run: async (ctx, payload: CreateAppointmentDto) => {
          const saved = await this.appointments.create(
            {
              ...payload,
              id: ctx.entityId,
              client_id: await this.resolveAlias(ctx, payload.client_id),
            },
            scope(ctx),
            { now: ctx.now, flagConflicts: true },
          );
          return this.appointmentOutcome(saved);
        },
      },
      'appointment.update': {
        dto: UpdateAppointmentDto,
        owner: true,
        needsEntity: true,
        run: async (ctx, payload: UpdateAppointmentDto) => {
          const saved = await this.appointments.update(
            ctx.entityId!,
            {
              ...payload,
              ...(payload.client_id
                ? { client_id: await this.resolveAlias(ctx, payload.client_id) }
                : {}),
            },
            ctx.tenantId,
            { now: ctx.now, flagConflicts: true },
          );
          return this.appointmentOutcome(saved);
        },
      },
      'appointment.cancel': {
        dto: CancelAppointmentDto,
        needsEntity: true,
        run: async (ctx, payload: CancelAppointmentDto) => {
          await this.appointments.cancel(
            ctx.entityId!,
            scope(ctx),
            payload.cancellation_reason,
          );
          return {};
        },
      },
      'appointment.complete': {
        needsEntity: true,
        run: async (ctx) => {
          await this.appointments.complete(ctx.entityId!, scope(ctx), ctx.now);
          return {};
        },
      },
      'payment.create': {
        dto: CreatePaymentDto,
        owner: true,
        creates: Payment,
        needsEntity: true,
        run: async (ctx, payload: CreatePaymentDto) => {
          const saved = await this.payments.create(
            { ...payload, id: ctx.entityId },
            ctx.tenantId,
            { reviewOnConflict: true },
          );
          return saved?.reviewRequired
            ? {
                status: 'conflict',
                code: saved.reviewRequired,
                saved: true,
                message: 'El pago quedó en revisión',
              }
            : {};
        },
      },
      'payment.refund': {
        dto: RefundPaymentDto,
        owner: true,
        needsEntity: true,
        run: async (ctx, payload) => {
          await this.payments.refund(ctx.entityId!, payload, ctx.tenantId);
          return {};
        },
      },
      'time_block.create': {
        dto: CreateTimeBlockDto,
        creates: TimeBlock,
        needsEntity: true,
        run: async (ctx, payload: CreateTimeBlockDto) => {
          await this.timeBlocks.create(
            { ...payload, id: ctx.entityId },
            ctx.tenantId,
          );
          return {};
        },
      },
      'time_block.update': {
        dto: UpdateTimeBlockDto,
        needsEntity: true,
        run: async (ctx, payload) => {
          await this.timeBlocks.update(ctx.entityId!, payload, ctx.tenantId);
          return {};
        },
      },
      'time_block.delete': {
        owner: true,
        needsEntity: true,
        deletes: true,
        run: async (ctx) => {
          await this.timeBlocks.remove(ctx.entityId!, ctx.tenantId);
          return {};
        },
      },
      'service.create': {
        dto: CreateServiceDto,
        owner: true,
        creates: Service,
        needsEntity: true,
        run: async (ctx, payload: CreateServiceDto) => {
          await this.services.create(
            { ...payload, id: ctx.entityId },
            ctx.tenantId,
          );
          return {};
        },
      },
      'service.update': {
        dto: UpdateServiceDto,
        owner: true,
        needsEntity: true,
        run: async (ctx, payload) => {
          await this.services.update(ctx.entityId!, payload, ctx.tenantId);
          return {};
        },
      },
      'service.delete': {
        owner: true,
        needsEntity: true,
        deletes: true,
        run: async (ctx) => {
          await this.services.remove(ctx.entityId!, ctx.tenantId);
          return {};
        },
      },
      'category.create': {
        dto: CreateCategoryDto,
        owner: true,
        creates: Category,
        needsEntity: true,
        run: async (ctx, payload: CreateCategoryDto) => {
          await this.categories.create(
            { ...payload, id: ctx.entityId },
            ctx.tenantId,
          );
          return {};
        },
      },
      'category.update': {
        dto: UpdateCategoryDto,
        owner: true,
        needsEntity: true,
        run: async (ctx, payload) => {
          await this.categories.update(ctx.entityId!, payload, ctx.tenantId);
          return {};
        },
      },
      'category.delete': {
        owner: true,
        needsEntity: true,
        deletes: true,
        run: async (ctx) => {
          await this.categories.remove(ctx.entityId!, ctx.tenantId);
          return {};
        },
      },
    };
  }

  /** `POST /sync/push`: aplica el lote en orden; un resultado por mutación. */
  async push(
    user: AuthUser,
    dto: SyncPushDto,
  ): Promise<{ results: SyncMutationResult[] }> {
    const results: SyncMutationResult[] = [];
    for (const mutation of dto.mutations) {
      results.push(await this.pushOne(user, dto.device_id ?? null, mutation));
    }
    return { results };
  }

  private async pushOne(
    user: AuthUser,
    deviceId: string | null,
    mutation: SyncMutationDto,
  ): Promise<SyncMutationResult> {
    const tenantId = tenantIdFrom(user);
    const base = {
      mutation_id: mutation.mutation_id,
      entity_id: mutation.entity_id ?? null,
    };

    // Idempotencia: la misma mutación devuelve lo mismo.
    const [stored] = await this.dataSource.query(
      `SELECT tenant_id, user_id, status, result FROM sync_mutations WHERE mutation_id = $1`,
      [mutation.mutation_id],
    );
    if (stored) {
      // Solo el mismo negocio Y el mismo usuario reciben el resultado
      // guardado; a cualquier otro, un rechazo genérico (nunca datos ajenos).
      if (stored.tenant_id !== tenantId || stored.user_id !== user.id) {
        return {
          ...base,
          status: 'rejected',
          code: ErrorCode.CONFLICT,
          message: 'mutation_id ya usado',
        };
      }
      return stored.status === 'pending'
        ? { ...base, status: 'retry', message: 'En proceso' }
        : (stored.result as SyncMutationResult);
    }
    const claimed = await this.dataSource.query(
      `INSERT INTO sync_mutations
         (mutation_id, tenant_id, user_id, device_id, type, entity_id, status, client_time)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       ON CONFLICT (mutation_id) DO NOTHING RETURNING mutation_id`,
      [
        mutation.mutation_id,
        tenantId,
        user.id,
        deviceId,
        mutation.type,
        mutation.entity_id ?? null,
        isNaN(Date.parse(mutation.client_time))
          ? null
          : new Date(mutation.client_time),
      ],
    );
    if (!claimed.length) {
      return { ...base, status: 'retry', message: 'En proceso' };
    }

    const result = await this.execute(user, tenantId, mutation, base);
    // Temporales: no se guardan, así reenviar la MISMA mutación la vuelve a
    // intentar (error del servidor, o cupo del trial / plan: rechazada hasta
    // que el negocio tenga un plan, decisión del orquestador).
    if (
      result.status === 'retry' ||
      TRANSIENT_REJECTIONS.has(result.code ?? '')
    ) {
      await this.dataSource.query(
        `DELETE FROM sync_mutations WHERE mutation_id = $1`,
        [mutation.mutation_id],
      );
    } else {
      await this.dataSource.query(
        `UPDATE sync_mutations SET status = $2, result = $3 WHERE mutation_id = $1`,
        [mutation.mutation_id, result.status, JSON.stringify(result)],
      );
    }
    return result;
  }

  private async execute(
    user: AuthUser,
    tenantId: string,
    mutation: SyncMutationDto,
    base: Pick<SyncMutationResult, 'mutation_id' | 'entity_id'>,
  ): Promise<SyncMutationResult> {
    const reject = (code: string, message: string): SyncMutationResult => ({
      ...base,
      status: 'rejected',
      code,
      message,
    });
    const handler = this.handlers[mutation.type];

    // Hora del dispositivo: hasta 30 días atrás y 5 min adelante.
    const now = new Date(mutation.client_time);
    const serverNow = Date.now();
    if (
      isNaN(now.getTime()) ||
      now.getTime() < serverNow - CLIENT_TIME_WINDOW.pastMs ||
      now.getTime() > serverNow + CLIENT_TIME_WINDOW.futureMs
    ) {
      return reject(
        ErrorCode.VALIDATION_ERROR,
        'La hora del dispositivo está fuera del rango permitido (30 días atrás, 5 minutos adelante)',
      );
    }
    if (handler.owner && isOnlyEmployee(user)) {
      return reject(ErrorCode.FORBIDDEN, 'No tienes permiso para esta acción');
    }
    if (handler.needsEntity && !mutation.entity_id) {
      return reject(ErrorCode.VALIDATION_ERROR, 'Falta entity_id');
    }

    const payload = await this.validPayload(handler, mutation.payload);
    if (typeof payload === 'string') {
      return reject(ErrorCode.VALIDATION_ERROR, payload);
    }

    const ctx: Context = {
      user,
      tenantId,
      now,
      entityId:
        handler.creates || !mutation.entity_id
          ? mutation.entity_id
          : await this.resolveAlias(
              { tenantId } as Context,
              mutation.entity_id,
            ),
    };
    if (
      handler.creates &&
      (await this.dataSource.getRepository(handler.creates).exist({
        where: { id: ctx.entityId, ownerId: tenantId },
      }))
    ) {
      return { ...base, status: 'applied' }; // ya se había aplicado
    }

    try {
      const outcome = await handler.run(ctx, payload);
      return { ...base, status: 'applied', ...outcome };
    } catch (error) {
      const body = this.errors.toBody(error);
      if (!(error instanceof HttpException) || body.statusCode >= 500) {
        this.logger.error(
          `Mutación ${mutation.mutation_id} (${mutation.type}): ${(error as Error)?.message}`,
        );
        return { ...base, status: 'retry', message: 'Error temporal' };
      }
      if (handler.deletes && body.code === ErrorCode.NOT_FOUND) {
        return { ...base, status: 'applied' }; // ya no existía
      }
      return {
        ...base,
        status: CONFLICT_CODES.has(body.code) ? 'conflict' : 'rejected',
        code: body.code,
        message: body.message,
      };
    }
  }

  /** `payload` validado con el DTO de la ruta online; texto del error si no vale. */
  private async validPayload(
    handler: Handler,
    payload: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    if (!handler.dto) return payload ?? {};
    const { id: _ignored, ...rest } = payload ?? {};
    void _ignored;
    const instance = plainToInstance(handler.dto, rest, {
      enableImplicitConversion: true,
    }) as object;
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (!errors.length) return instance;
    return errors
      .flatMap((e) =>
        Object.values(e.constraints ?? { [e.property]: e.property }),
      )
      .join('\n');
  }

  /**
   * Alta de un cliente (manual o importado). Mismo teléfono en el negocio: se
   * fusiona (§4) y queda el alias del id del dispositivo.
   */
  private async createClient(
    ctx: Context,
    payload: CreateClientDto,
    fromDevice: boolean,
  ): Promise<Partial<SyncMutationResult>> {
    const existing = await this.dataSource
      .getRepository(Client)
      .findOne({ where: { ownerId: ctx.tenantId, phone: payload.phone } });
    if (existing) {
      await this.addAlias(ctx, 'clients', existing.id);
      return { status: 'merged', merged_into: existing.id };
    }
    await this.clients.create({ ...payload, id: ctx.entityId }, ctx.tenantId, {
      fromDevice,
    });
    return {};
  }

  /** El id con el que quedó un cliente fusionado (o el mismo). */
  private async resolveAlias(ctx: Context, id: string): Promise<string> {
    if (!id) return id;
    const [row] = await this.dataSource.query(
      `SELECT target_id FROM sync_id_aliases
        WHERE entity = 'clients' AND alias_id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return row?.target_id ?? id;
  }

  private async addAlias(
    ctx: Context,
    entity: string,
    targetId: string,
  ): Promise<void> {
    if (!ctx.entityId || ctx.entityId === targetId) return;
    await this.dataSource.query(
      `INSERT INTO sync_id_aliases (tenant_id, entity, alias_id, target_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [ctx.tenantId, entity, ctx.entityId, targetId],
    );
  }

  /** Conflicto de hueco: la cita quedó guardada y marcada para mover. */
  private appointmentOutcome(saved: Appointment): Partial<SyncMutationResult> {
    return saved?.needsReschedule
      ? {
          status: 'conflict',
          code: saved.syncConflict ?? ErrorCode.SLOT_UNAVAILABLE,
          saved: true,
          message: 'La cita quedó guardada; hay que moverla',
        }
      : {};
  }
}
