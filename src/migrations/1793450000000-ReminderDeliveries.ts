import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 11.02: motor de recordatorios. `reminder_deliveries` (registro
 * idempotente: una entrega por regla, objetivo y ocurrencia) y
 * `whatsapp_usage` (consumo mensual por negocio). Solo tablas nuevas.
 */
export class ReminderDeliveries1793450000000 implements MigrationInterface {
  name = 'ReminderDeliveries1793450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "whatsapp_usage" (
      "owner_id" uuid NOT NULL,
      "period" character varying(7) NOT NULL,
      "used" integer NOT NULL DEFAULT '0',
      "exhausted_notified_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_a69ff4d50c3a56520bf510bb1cc" PRIMARY KEY ("owner_id", "period")
      )

    `);
    await queryRunner.query(`
      CREATE TABLE "reminder_deliveries" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "owner_id" uuid NOT NULL,
      "rule_id" uuid,
      "kind" character varying(20) NOT NULL,
      "client_id" uuid,
      "appointment_id" uuid,
      "target_id" uuid NOT NULL,
      "occurrence_key" character varying(64) NOT NULL,
      "status" character varying(12) NOT NULL DEFAULT 'queued',
      "reason" character varying(40),
      "scheduled_for" TIMESTAMP WITH TIME ZONE NOT NULL,
      "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "attempts" integer NOT NULL DEFAULT '0',
      "category" character varying(10) NOT NULL,
      "phone" character varying(20),
      "body" text,
      "template_name" character varying(100),
      "provider_message_id" character varying(128),
      "last_error" text,
      "sent_at" TIMESTAMP WITH TIME ZONE,
      "delivered_at" TIMESTAMP WITH TIME ZONE,
      "read_at" TIMESTAMP WITH TIME ZONE,
      "failed_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_453ad425bb5e104e059a105a8b7" UNIQUE ("provider_message_id"),
      CONSTRAINT "PK_27a51a312a6045e6390716e6de0" PRIMARY KEY ("id")
      )

    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reminder_deliveries_owner" ON "reminder_deliveries" ("owner_id", "created_at")

    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_reminder_deliveries_due" ON "reminder_deliveries" ("status", "next_attempt_at")

    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_reminder_deliveries_once" ON "reminder_deliveries" ("rule_id", "target_id", "occurrence_key")

    `);
    await queryRunner.query(`
      ALTER TABLE "whatsapp_usage"
      ADD CONSTRAINT "FK_d63a836a2b53dc7e2b665cfc3fb" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries"
      ADD CONSTRAINT "FK_a116add35c0b93fcbe261c174e4" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries"
      ADD CONSTRAINT "FK_eba8f26be0f7dbc3b791cb52cc1" FOREIGN KEY ("rule_id") REFERENCES "reminder_rules"("id") ON DELETE
      SET NULL ON UPDATE NO ACTION

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries"
      ADD CONSTRAINT "FK_2039c3bc40d77ccc8df54b49942" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries"
      ADD CONSTRAINT "FK_057193bb009d91538eab21bc146" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE
      SET NULL ON UPDATE NO ACTION

    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries" DROP CONSTRAINT "FK_057193bb009d91538eab21bc146"

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries" DROP CONSTRAINT "FK_2039c3bc40d77ccc8df54b49942"

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries" DROP CONSTRAINT "FK_eba8f26be0f7dbc3b791cb52cc1"

    `);
    await queryRunner.query(`
      ALTER TABLE "reminder_deliveries" DROP CONSTRAINT "FK_a116add35c0b93fcbe261c174e4"

    `);
    await queryRunner.query(`
      ALTER TABLE "whatsapp_usage" DROP CONSTRAINT "FK_d63a836a2b53dc7e2b665cfc3fb"

    `);
    await queryRunner.query(`
      DROP INDEX "public"."UQ_reminder_deliveries_once"

    `);
    await queryRunner.query(`
      DROP INDEX "public"."IDX_reminder_deliveries_due"

    `);
    await queryRunner.query(`
      DROP INDEX "public"."IDX_reminder_deliveries_owner"

    `);
    await queryRunner.query(`
      DROP TABLE "reminder_deliveries"

    `);
    await queryRunner.query(`
      DROP TABLE "whatsapp_usage"

    `);
  }
}
