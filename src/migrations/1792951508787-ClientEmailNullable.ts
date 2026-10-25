import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2.20: `clients.email` opcional (el DTO ya lo era y un alta sin email daba
 * 23502 → 500). `up` no transforma datos: solo quita el NOT NULL.
 * `down` necesita un valor en las filas sin email: pone un marcador
 * `sin-email-<id>@invalid` (dominio reservado, nunca entrega correo).
 */
export class ClientEmailNullable1792951508787 implements MigrationInterface {
  name = 'ClientEmailNullable1792951508787';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clients" ALTER COLUMN "email" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "clients" SET "email" = 'sin-email-' || "id" || '@invalid' WHERE "email" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "clients" ALTER COLUMN "email" SET NOT NULL`,
    );
  }
}
