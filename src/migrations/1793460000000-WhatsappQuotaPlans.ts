import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-21 (aprobado por el usuario, 2026-10-31): cada plan pagado incluye 300
 * mensajes de WhatsApp automáticos al mes. TRANSFORMA DATOS APROBADOS: pone
 * `whatsapp_monthly_quota = 300` en los 3 planes de la semilla
 * (`SeedRolesAndPlans`, mismos ids en todas las bases). Idempotente; en una
 * BD nueva corre después de la semilla, así que los planes nacen con 300.
 * `down` los devuelve a 0 (valor por defecto de la columna).
 */
export const PAID_PLAN_IDS = [
  '595331e0-b7e9-48e2-9ca8-8a5e4cdf18f4',
  '5d543904-e986-4946-bf36-9f2805922638',
  '8f6cda6a-3623-4bcc-a5cf-cbe8e29f01cb',
] as const;
export const PAID_PLAN_WHATSAPP_QUOTA = 300;

export class WhatsappQuotaPlans1793460000000 implements MigrationInterface {
  name = 'WhatsappQuotaPlans1793460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "subscription_plans" SET "whatsapp_monthly_quota" = $2
        WHERE "id" = ANY($1::uuid[])`,
      [PAID_PLAN_IDS, PAID_PLAN_WHATSAPP_QUOTA],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "subscription_plans" SET "whatsapp_monthly_quota" = 0
        WHERE "id" = ANY($1::uuid[])`,
      [PAID_PLAN_IDS],
    );
  }
}
