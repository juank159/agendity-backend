import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 6.01 (D-15): configuración por negocio (`business_settings`, entidad
 * `BusinessSettings`), con la zona horaria IANA de cada tenant.
 *
 * - Una fila por tenant: `tenant_id` = id del Owner (PK y FK a `users`, ON
 *   DELETE CASCADE).
 * - Rellena `America/Bogota` para cada Owner existente (rol `Owner`, también
 *   los dados de baja): es la zona con la que se escribieron sus datos hasta
 *   hoy (`BUSINESS_TIMEZONE` por defecto).
 *
 * No modifica ni borra ningún dato existente: solo crea la tabla e inserta
 * filas nuevas. `down` borra la tabla (y con ella las filas que insertó).
 */
export class BusinessSettings1793205042483 implements MigrationInterface {
  name = 'BusinessSettings1793205042483';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "business_settings" (
        "tenant_id" uuid NOT NULL,
        "timezone" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_9fd211d3f6ed745188b90461f95" PRIMARY KEY ("tenant_id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "business_settings"
      ADD CONSTRAINT "FK_9fd211d3f6ed745188b90461f95" FOREIGN KEY ("tenant_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      INSERT INTO "business_settings" ("tenant_id", "timezone")
      SELECT DISTINCT u."id", 'America/Bogota'
        FROM "users" u
        JOIN "user_has_roles" ur ON ur."user_id" = u."id"
        JOIN "roles" r ON r."id" = ur."role_id"
       WHERE r."name" = 'Owner'
      ON CONFLICT ("tenant_id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_settings" DROP CONSTRAINT "FK_9fd211d3f6ed745188b90461f95"
    `);
    await queryRunner.query(`
      DROP TABLE "business_settings"
    `);
  }
}
