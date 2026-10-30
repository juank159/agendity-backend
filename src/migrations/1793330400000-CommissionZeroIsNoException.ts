import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 8.02 (D-16) — **TRANSFORMA DATOS** (aplicar solo con aprobación, D-13).
 *
 * Hasta 8.02, `user_services.commissionPercentage` era NOT NULL DEFAULT 0 y no
 * se usaba en ningún cálculo: un 0 era "no se indicó", no "0 % a propósito".
 * Desde 8.02, NULL = sin excepción (se usa la comisión general del empleado) y
 * 0 = 0 % de verdad. Esta migración pasa los 0 existentes a NULL para que esos
 * servicios tomen la comisión general. Los valores distintos de 0 no cambian.
 *
 * Guarda las filas tocadas en `migration_backup_user_service_commission`
 * (id, valor anterior) y no toca `updated_at`; `down` las restaura a 0 (solo
 * las que sigan en NULL).
 */
export class CommissionZeroIsNoException1793330400000
  implements MigrationInterface
{
  name = 'CommissionZeroIsNoException1793330400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "migration_backup_user_service_commission" AS
      SELECT "id", "commissionPercentage" AS "previous"
        FROM "user_services"
       WHERE "commissionPercentage" = 0
    `);
    await queryRunner.query(`
      UPDATE "user_services" SET "commissionPercentage" = NULL
       WHERE "id" IN (SELECT "id" FROM "migration_backup_user_service_commission")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "user_services" us SET "commissionPercentage" = b."previous"
        FROM "migration_backup_user_service_commission" b
       WHERE b."id" = us."id" AND us."commissionPercentage" IS NULL
    `);
    await queryRunner.query(
      `DROP TABLE "migration_backup_user_service_commission"`,
    );
  }
}
