import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 7.03 (a): datos de referencia que el código necesita y que ninguna
 * migración creaba. En una BD nueva no había `roles` ni `subscription_plans`,
 * así que registrar un Owner daba 500 (`findRole`, `auth/user-accounts.ts`).
 *
 * Los mismos valores (ids incluidos) que hay en `ecommerce` desde 2025-05-01,
 * leídos con SELECT. **Idempotente**: solo inserta lo que falta (rol por
 * `name`, que es único; plan por `id` o por `name`), así que en una base que
 * ya los tiene (`ecommerce`, `agendity_demo`) no cambia nada.
 *
 * `wompi_price_id` son los ids de los enlaces de pago de Wompi actuales
 * (sandbox); en producción se revisan con la Fase D.
 *
 * `down` no borra nada a propósito: en las bases donde las filas ya existían
 * antes de esta migración, borrarlas eliminaría datos que no creó (y las
 * filas están referenciadas por `user_has_roles` y `subscriptions`).
 */
const ROLES = [
  [
    'f3bc4f0f-0ad5-4734-a6bd-27fdf89401ce',
    'Employee',
    '2025-05-01 15:39:53.975575+00',
  ],
  [
    'afdb9940-97e9-45d2-9e95-95802c304e58',
    'Admin',
    '2025-05-01 15:40:06.913336+00',
  ],
  [
    'ceabe872-19bb-4323-8a1e-4b786c64eefb',
    'Owner',
    '2025-05-01 15:40:19.613224+00',
  ],
] as const;

const PLANS = [
  {
    id: '595331e0-b7e9-48e2-9ca8-8a5e4cdf18f4',
    name: 'Plan Profesional Mensual',
    description:
      'Agenda ilimitada de citas. Incluye recordatorios automáticos y análisis de clientes. Facturación mensual.',
    price: '27000.00',
    billingInterval: 'month',
    wompiPriceId: '8z6PMC',
    durationMonths: 1,
    createdAt: '2025-05-01 20:39:54.942261+00',
  },
  {
    id: '5d543904-e986-4946-bf36-9f2805922638',
    name: 'Plan Profesional Semestral (6 meses)',
    description:
      'Pago único por 6 meses. Ahorra un 10% con nuestro plan semestral. Agenda ilimitada de citas.',
    price: '149900.00',
    billingInterval: 'month',
    wompiPriceId: 'QL1V2B',
    durationMonths: 6,
    createdAt: '2025-05-01 20:41:04.954759+00',
  },
  {
    id: '8f6cda6a-3623-4bcc-a5cf-cbe8e29f01cb',
    name: 'Plan Profesional Premium Anual',
    description:
      'Pago único por 12 meses. Nuestra mejor oferta con un 15% de descuento. Agenda ilimitada de citas por un año completo.',
    price: '285900.00',
    billingInterval: 'year',
    wompiPriceId: 'VxQSkQ',
    durationMonths: 12,
    createdAt: '2025-05-01 20:42:16.292509+00',
  },
] as const;

export class SeedRolesAndPlans1793290000000 implements MigrationInterface {
  name = 'SeedRolesAndPlans1793290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, name, createdAt] of ROLES) {
      await queryRunner.query(
        `INSERT INTO "roles" ("id", "name", "image", "route", "created_at", "updated_at")
         VALUES ($1::uuid, $2::varchar, NULL, NULL, $3::timestamptz, $3::timestamptz)
         ON CONFLICT ("name") DO NOTHING`,
        [id, name, createdAt],
      );
    }
    for (const plan of PLANS) {
      await queryRunner.query(
        `INSERT INTO "subscription_plans"
           ("id", "name", "description", "price", "currency", "billing_interval",
            "appointment_limit", "wompi_price_id", "is_active", "created_at",
            "updated_at", "duration_months", "is_recurring", "features")
         SELECT $1::uuid, $2::varchar, $3::varchar, $4::numeric, 'COP', $5::varchar,
                -1, $6::varchar, true, $7::timestamptz, $7::timestamptz, $8::int, false, ''
          WHERE NOT EXISTS (
            SELECT 1 FROM "subscription_plans" WHERE "id" = $1::uuid OR "name" = $2::varchar
          )`,
        [
          plan.id,
          plan.name,
          plan.description,
          plan.price,
          plan.billingInterval,
          plan.wompiPriceId,
          plan.createdAt,
          plan.durationMonths,
        ],
      );
    }
  }

  public async down(): Promise<void> {
    // Sin cambios a propósito (ver el comentario de la clase).
  }
}
