import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.31 (transformación aprobada por el usuario el 2026-10-27): los
 * clientes importados antes de la 4.06 tienen el email de relleno
 * `no-email@example.com`. Desde 2.20 el email es opcional: pasan a `NULL`.
 *
 * Solo datos, sin cambios de esquema. `updated_at` no se toca (es una
 * limpieza, no una edición del cliente).
 *
 * El email original (con sus mayúsculas) se guarda en
 * `migration_backup_client_emails` para que `down` restaure exactamente esos
 * clientes. Si alguno recibió después un email real, `down` lo respeta.
 * Esa tabla no es de ninguna entidad.
 */
export class ClientFakeEmailToNull1793162107399 implements MigrationInterface {
  name = 'ClientFakeEmailToNull1793162107399';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "migration_backup_client_emails" (
        "id" uuid NOT NULL,
        "old_email" text NOT NULL,
        CONSTRAINT "PK_migration_backup_client_emails" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "migration_backup_client_emails" ("id", "old_email")
      SELECT "id", "email" FROM "clients"
      WHERE lower("email") = 'no-email@example.com'
    `);
    await queryRunner.query(`
      UPDATE "clients" c SET "email" = NULL
      FROM "migration_backup_client_emails" b
      WHERE b."id" = c."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "clients" c SET "email" = b."old_email"
      FROM "migration_backup_client_emails" b
      WHERE b."id" = c."id" AND c."email" IS NULL
    `);
    await queryRunner.query(`DROP TABLE "migration_backup_client_emails"`);
  }
}
