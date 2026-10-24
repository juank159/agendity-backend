import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.10: `users.phone` pasa a ser opcional (sigue siendo único).
 *
 * Las altas sin teléfono (login con Google y el registro temporal de
 * `verify/request-code`) guardaban `''`/`'Pendiente'`, y el índice único
 * `UQ_a000cca60bcf04454e727699490` hacía fallar la segunda. Con NULL, Postgres
 * admite varias filas sin teléfono.
 *
 * `up`: quita el NOT NULL y convierte esos marcadores (y los `sin-telefono-…`
 * que deja `down`) en NULL. En `ecommerce` no había ninguno el 2026-10-23.
 * `down`: vuelve a NOT NULL; como no puede haber dos `''`, cada fila sin
 * teléfono recibe un marcador único `sin-telefono-<id>` (no se pierde ningún
 * teléfono real).
 */
export class UserPhoneNullable1792815420176 implements MigrationInterface {
  name = 'UserPhoneNullable1792815420176';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "users" SET "phone" = NULL
       WHERE "phone" IN ('', 'Pendiente') OR "phone" LIKE 'sin-telefono-%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" SET "phone" = 'sin-telefono-' || "id" WHERE "phone" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL
    `);
  }
}
