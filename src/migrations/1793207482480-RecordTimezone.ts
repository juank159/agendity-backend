import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 6.03 (D-15, decisión del usuario del 2026-10-28): cada registro de
 * negocio con hora guarda la zona con la que se creó (`timezone`, IANA, NOT
 * NULL) en `appointments`, `time_block` y `payments`. Si el negocio cambia de
 * zona, lo histórico conserva la suya.
 *
 * Las filas existentes se rellenan con la zona ACTUAL de su negocio
 * (`business_settings`; `America/Bogota` si no hubiera fila). El negocio de un
 * bloqueo es el de su profesional (`users.owner_id`, o él mismo si es el
 * Owner). No modifica ni borra ningún dato existente: solo añade columnas y
 * las rellena. `down` las borra.
 */
export class RecordTimezone1793207482480 implements MigrationInterface {
  name = 'RecordTimezone1793207482480';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['appointments', 'payments', 'time_block']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD "timezone" character varying(64)`,
      );
    }
    await queryRunner.query(`
      UPDATE "appointments" a
         SET "timezone" = COALESCE(
           (SELECT bs."timezone" FROM "business_settings" bs
             WHERE bs."tenant_id" = a."owner_id"),
           'America/Bogota')
    `);
    await queryRunner.query(`
      UPDATE "payments" p
         SET "timezone" = COALESCE(
           (SELECT bs."timezone" FROM "business_settings" bs
             WHERE bs."tenant_id" = p."owner_id"),
           'America/Bogota')
    `);
    await queryRunner.query(`
      UPDATE "time_block" tb
         SET "timezone" = COALESCE(
           (SELECT bs."timezone"
              FROM "users" u
              JOIN "business_settings" bs
                ON bs."tenant_id" = COALESCE(u."owner_id", u."id")
             WHERE u."id" = tb."userId"),
           'America/Bogota')
    `);
    for (const table of ['appointments', 'payments', 'time_block']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "timezone" SET NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['appointments', 'payments', 'time_block']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "timezone"`);
    }
  }
}
