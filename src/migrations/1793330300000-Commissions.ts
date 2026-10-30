import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 8.02 (D-16): comisiones.
 * - `users.commission_percentage`: comisión general del profesional (0 a 100,
 *   por defecto 0).
 * - `user_services.commissionPercentage` pasa a admitir NULL (= sin excepción:
 *   se usa la general) y pierde el DEFAULT 0. Los valores que ya hay NO se
 *   tocan aquí (pasar los 0 a NULL es otra migración, que transforma datos).
 * - `appointment_services.commission_percentage`: % congelado en cada línea de
 *   cita. Las líneas existentes se rellenan con el % efectivo de HOY de su
 *   profesional (excepción activa del servicio si existe; si no, su general,
 *   que es 0 para todos al crear la columna), igual que se hizo con el precio
 *   en 2.29. Solo añade columnas y las rellena: no modifica datos existentes.
 * `down`: borra las columnas nuevas y devuelve el NOT NULL DEFAULT 0 (una
 * excepción vacía vuelve a 0, su significado anterior).
 */
export class Commissions1793330300000 implements MigrationInterface {
  name = 'Commissions1793330300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "commission_percentage" numeric(5, 2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_services" ALTER COLUMN "commissionPercentage" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_services" ALTER COLUMN "commissionPercentage" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointment_services" ADD "commission_percentage" numeric(5, 2)`,
    );
    await queryRunner.query(`
      UPDATE "appointment_services" l
         SET "commission_percentage" = COALESCE(
           (SELECT us."commissionPercentage"
              FROM "appointments" a
              JOIN "user_services" us
                ON us."user_id" = a."professional_id"
               AND us."service_id" = l."service_id"
               AND us."isActive"
             WHERE a."id" = l."appointment_id"
             LIMIT 1),
           (SELECT u."commission_percentage"
              FROM "appointments" a
              JOIN "users" u ON u."id" = a."professional_id"
             WHERE a."id" = l."appointment_id"),
           0)
    `);
    await queryRunner.query(
      `ALTER TABLE "appointment_services" ALTER COLUMN "commission_percentage" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointment_services" DROP COLUMN "commission_percentage"`,
    );
    await queryRunner.query(
      `UPDATE "user_services" SET "commissionPercentage" = 0 WHERE "commissionPercentage" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_services" ALTER COLUMN "commissionPercentage" SET DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_services" ALTER COLUMN "commissionPercentage" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "commission_percentage"`,
    );
  }
}
