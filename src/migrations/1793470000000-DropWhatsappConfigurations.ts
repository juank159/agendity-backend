import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-21: se retira CallMeBot. Borra `whatsapp_configurations` (guardaba el
 * `api_key` de CallMeBot de cada Owner). Comprobado el 2026-11-01: 0 filas en
 * `ecommerce` y en `agendity_demo`. Por seguridad, `up` FALLA si la tabla
 * tiene filas (no borra datos sin revisar). `down` la vuelve a crear vacía.
 */
export class DropWhatsappConfigurations1793470000000
  implements MigrationInterface
{
  name = 'DropWhatsappConfigurations1793470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "whatsapp_configurations"`,
    );
    if (count > 0) {
      throw new Error(
        `whatsapp_configurations tiene ${count} filas: revísalas antes de borrar la tabla`,
      );
    }
    await queryRunner.query(`DROP TABLE "whatsapp_configurations"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "whatsapp_configurations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_id" uuid NOT NULL,
        "phone_number" text NOT NULL,
        "api_key" text NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_1506e31515dddca372e3b1fa0f6" PRIMARY KEY ("id")
      )`);
  }
}
