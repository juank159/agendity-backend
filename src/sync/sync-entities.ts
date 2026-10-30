import { EntityManager, In } from 'typeorm';
import { Appointment } from 'src/appointments/entities/appointment.entity';
import { RELATION_GROUPS } from 'src/appointments/constants/relations.constants';
import { Category } from 'src/categories/entities/category.entity';
import { Client } from 'src/clients/entities/client.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { CustomPaymentMethod } from 'src/payments/entities/custom-payment-method.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { Review } from 'src/reviews/entities/review.entity';
import { Schedule } from 'src/schedules/entities/schedule.entity';
import { Service } from 'src/services/entities/service.entity';
import { BusinessSettings } from 'src/settings/entities/business-settings.entity';
import { TimeBlock } from 'src/time-blocks/entities/time-block.entity';
import { UserService } from 'src/user-services/entities/user-service.entity';
import { User } from 'src/users/entities/user.entity';
import { toUserResponse } from 'src/auth/user-accounts';

/** Quién pide los cambios. */
export interface SyncViewer {
  tenantId: string;
  userId: string;
  /** Employee (no Owner): ve menos (ver `ownerOnly` y `scope`). */
  employee: boolean;
}

/**
 * Una tabla que baja a la app (10.01a, D-18). Los permisos son los de la API
 * de hoy:
 * - `ownerOnly`: el Employee no la recibe (pagos, métodos de pago propios,
 *   reseñas: hoy no los lista).
 * - `scope`: columna con el usuario que la ve (`employeeOnly` = solo para el
 *   Employee; si no, para los dos roles, p. ej. notificaciones del receptor).
 */
export interface SyncEntity {
  /** Nombre que ve la app (= nombre de la tabla, como en `sync_tombstones`). */
  name: string;
  table: string;
  tenantColumn: string;
  idColumn: string;
  ownerOnly?: boolean;
  scope?: { column: string; employeeOnly: boolean };
  /** Filas actuales por id, ya con la forma de la API para ese rol. */
  load(
    manager: EntityManager,
    ids: string[],
    viewer: SyncViewer,
  ): Promise<{ id: string; data: unknown }[]>;
}

const byId =
  <T extends { id: string }>(
    entity: new () => T,
    options: { relations?: string[]; loadRelationIds?: boolean } = {},
  ) =>
  async (manager: EntityManager, ids: string[]) =>
    (
      await manager.getRepository(entity).find({
        where: { id: In(ids) } as never,
        ...options,
      })
    ).map((row) => ({ id: row.id, data: row }));

/** Registro de lo que se sincroniza, en el orden en que se documenta. */
export const SYNC_ENTITIES: SyncEntity[] = [
  {
    name: 'business_settings',
    table: 'business_settings',
    tenantColumn: 'tenant_id',
    idColumn: 'tenant_id',
    load: async (manager, ids) =>
      (
        await manager
          .getRepository(BusinessSettings)
          .find({ where: { tenant_id: In(ids) } })
      ).map((row) => ({
        id: row.tenant_id,
        data: {
          tenant_id: row.tenant_id,
          name: row.name,
          slug: row.slug,
          timezone: row.timezone,
          opening_hours: row.opening_hours,
        },
      })),
  },
  {
    name: 'users',
    table: 'users',
    tenantColumn: 'tenant_id',
    idColumn: 'id',
    load: async (manager, ids, viewer) => {
      const users = await manager.getRepository(User).find({
        where: { id: In(ids) },
        relations: ['roles'],
        withDeleted: true,
      });
      return users.map((user) => ({
        id: user.id,
        // El Employee ve a sus compañeros solo con lo necesario para la agenda.
        data: viewer.employee
          ? {
              id: user.id,
              name: user.name,
              lastname: user.lastname,
              image: user.image ?? null,
              isActive: user.isActive,
              deletedAt: user.deletedAt ?? null,
              roles: user.roles.map((role) => ({ name: role.name })),
            }
          : toUserResponse(user),
      }));
    },
  },
  {
    name: 'categories',
    table: 'categories',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    load: byId(Category),
  },
  {
    name: 'services',
    table: 'services',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    load: byId(Service, { loadRelationIds: true }),
  },
  {
    name: 'user_services',
    table: 'user_services',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    load: byId(UserService),
  },
  {
    name: 'schedules',
    table: 'schedules',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    load: byId(Schedule, { loadRelationIds: true }),
  },
  {
    name: 'clients',
    table: 'clients',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    load: byId(Client),
  },
  {
    name: 'appointments',
    table: 'appointments',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    scope: { column: 'professional_id', employeeOnly: true },
    load: byId(Appointment, { relations: RELATION_GROUPS.default }),
  },
  {
    name: 'time_block',
    table: 'time_block',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    scope: { column: '"userId"', employeeOnly: true },
    load: byId(TimeBlock, { loadRelationIds: true }),
  },
  {
    name: 'payments',
    table: 'payments',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    ownerOnly: true,
    load: byId(Payment, { loadRelationIds: true }),
  },
  {
    name: 'custom_payment_methods',
    table: 'custom_payment_methods',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    ownerOnly: true,
    load: byId(CustomPaymentMethod),
  },
  {
    name: 'reviews',
    table: 'reviews',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    ownerOnly: true,
    load: byId(Review, { loadRelationIds: true }),
  },
  {
    name: 'notifications',
    table: 'notifications',
    tenantColumn: 'owner_id',
    idColumn: 'id',
    // Las del receptor, para los dos roles (como `GET /notifications/receiver/:id`).
    scope: { column: 'receiver_id', employeeOnly: false },
    load: byId(Notification),
  },
];

/** Entidades que ve este rol. */
export function visibleEntities(viewer: SyncViewer): SyncEntity[] {
  return SYNC_ENTITIES.filter((e) => !(viewer.employee && e.ownerOnly));
}

/** ¿Esta entidad se filtra por usuario para este rol? */
export function isScoped(entity: SyncEntity, viewer: SyncViewer): boolean {
  return !!entity.scope && (viewer.employee || !entity.scope.employeeOnly);
}
