import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.03: la duración del plan sale de `subscription_plans.duration_months`
 * (antes se deducía del nombre: "semestral" = 6, "anual" o `billing_interval =
 * 'year'` = 12, el resto 1). Los planes existentes tienen `duration_months = 1`
 * (valor por defecto de la columna), así que el semestral y el anual durarían un
 * mes. Esta migración (solo datos) les pone la duración que el nombre indicaba.
 *
 * Solo toca filas con `duration_months = 1` cuyo nombre o intervalo dicen otra
 * cosa. Los ids y el valor anterior se guardan en
 * `migration_backup_plan_duration` para que `down` los restaure exactamente.
 */
export class PlanDurationMonths1792649756295 implements MigrationInterface {
  name = 'PlanDurationMonths1792649756295';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "migration_backup_plan_duration" (
        "id" uuid NOT NULL,
        "old_duration_months" integer NOT NULL,
        CONSTRAINT "PK_migration_backup_plan_duration" PRIMARY KEY ("id")
      )
    `);

    // Misma regla que usaba el código: "semestral" gana a "anual".
    const target = `
      SELECT p."id",
        CASE
          WHEN lower(p."name") LIKE '%semestral%' THEN 6
          WHEN lower(p."name") LIKE '%anual%' OR p."billing_interval" = 'year' THEN 12
        END AS months
      FROM "subscription_plans" p
      WHERE p."duration_months" = 1
    `;

    await queryRunner.query(`
      INSERT INTO "migration_backup_plan_duration" ("id", "old_duration_months")
      SELECT t."id", 1 FROM (${target}) t WHERE t.months IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "subscription_plans" p SET "duration_months" = t.months
      FROM (${target}) t
      WHERE p."id" = t."id" AND t.months IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "subscription_plans" p SET "duration_months" = b."old_duration_months"
      FROM "migration_backup_plan_duration" b
      WHERE b."id" = p."id"
    `);
    await queryRunner.query(`DROP TABLE "migration_backup_plan_duration"`);
  }
}
