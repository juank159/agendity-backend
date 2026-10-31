import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 11.01: reglas de recordatorios automáticos por negocio.
 *
 * - `reminder_settings` (activación y ventana de envío) y `reminder_rules`.
 * - `services.maintenance_days`, consentimiento de WhatsApp en `clients`
 *   (`whatsapp_opt_in`, `_at`, `whatsapp_opt_out_at`) y
 *   `subscription_plans.whatsapp_monthly_quota` (0 por defecto).
 *
 * Solo crea tablas y columnas nuevas (con valor por defecto): no transforma
 * datos. `down` las borra.
 */
export class ReminderRules1793440000000 implements MigrationInterface {
  name = 'ReminderRules1793440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reminder_settings" (
      "tenant_id" uuid NOT NULL,
      "enabled" boolean NOT NULL DEFAULT false,
      "send_window_start" character varying(5) NOT NULL DEFAULT '08:00',
      "send_window_end" character varying(5) NOT NULL DEFAULT '20:00',
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_9af54e80bd7a3d084b139bbf9f4" PRIMARY KEY ("tenant_id")
      )

    `);
    await queryRunner.query(`
      CREATE TABLE "reminder_rules" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "owner_id" uuid NOT NULL,
      "kind" character varying(20) NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "minutes_before" integer,
      "days_without_visit" integer,
      "send_time" character varying(5),
      "template" text NOT NULL,
      "category" character varying(10) NOT NULL,
      "meta_template_name" character varying(100),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_reminder_rules_category" CHECK ("category" IN ('utility', 'marketing')),
      CONSTRAINT "CHK_reminder_rules_kind" CHECK (
      "kind" IN (
      'before_appointment',
      'maintenance',
      'birthday',
      'win_back'
      )
      ),
      CONSTRAINT "PK_b42e2f1ee2f100d8471b63a2cb7" PRIMARY KEY ("id")
      )

    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_reminder_rules_kind" ON "reminder_rules" ("owner_id", "kind")
      WHERE "kind" <> 'before_appointment'

    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_reminder_rules_before" ON "reminder_rules" ("owner_id", "minutes_before")
      WHERE "kind" = 'before_appointment'

    `);
    await queryRunner.query(`
      ALTER TABLE "services"
      ADD "maintenance_days" integer

    `);
    await queryRunner.query(`
      ALTER TABLE "clients"
      ADD "whatsapp_opt_in" boolean NOT NULL DEFAULT false

    `);
    await queryRunner.query(`
      ALTER TABLE "clients"
      ADD "whatsapp_opt_in_at" TIMESTAMP WITH TIME ZONE

    `);
    await queryRunner.query(`
      ALTER TABLE "clients"
      ADD "whatsapp_opt_out_at" TIMESTAMP WITH TIME ZONE

    `);
    await queryRunner.query(`
      ALTER TABLE "subscription_plans"
      ADD "whatsapp_monthly_quota" integer NOT NULL DEFAULT '0'

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_settings"
      ADD CONSTRAINT "FK_9af54e80bd7a3d084b139bbf9f4" FOREIGN KEY ("tenant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_rules"
      ADD CONSTRAINT "FK_a3d46cc17b12ae1cc4785e5eac8" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION

    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reminder_rules" DROP CONSTRAINT "FK_a3d46cc17b12ae1cc4785e5eac8"

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_settings" DROP CONSTRAINT "FK_9af54e80bd7a3d084b139bbf9f4"

    `);
    await queryRunner.query(`
      ALTER TABLE "subscription_plans" DROP COLUMN "whatsapp_monthly_quota"

    `);
    await queryRunner.query(`
      ALTER TABLE "clients" DROP COLUMN "whatsapp_opt_out_at"

    `);
    await queryRunner.query(`
      ALTER TABLE "clients" DROP COLUMN "whatsapp_opt_in_at"

    `);
    await queryRunner.query(`
      ALTER TABLE "clients" DROP COLUMN "whatsapp_opt_in"

    `);
    await queryRunner.query(`
      ALTER TABLE "services" DROP COLUMN "maintenance_days"

    `);
    await queryRunner.query(`
      DROP INDEX "public"."UQ_reminder_rules_before"

    `);
    await queryRunner.query(`
      DROP INDEX "public"."UQ_reminder_rules_kind"

    `);
    await queryRunner.query(`
      DROP TABLE "reminder_rules"

    `);
    await queryRunner.query(`
      DROP TABLE "reminder_settings"

    `);
  }
}
