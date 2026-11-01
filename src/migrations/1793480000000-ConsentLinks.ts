import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 11.06: consentimiento de WhatsApp por link. Tabla `whatsapp_consent_links`
 * (un link por fila: lo hace de un solo uso y guarda la prueba del
 * consentimiento, Ley 1581) y `clients.whatsapp_opt_in_source` (`APP`, `WEB`
 * o `LINK`). Solo crea tabla y columna nueva (nula): no transforma datos.
 */

export class ConsentLinks1793480000000 implements MigrationInterface {
  name = 'ConsentLinks1793480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "whatsapp_consent_links" (
                "id" uuid NOT NULL,
                "owner_id" uuid NOT NULL,
                "client_id" uuid NOT NULL,
                "created_by" uuid,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "accepted_at" TIMESTAMP WITH TIME ZONE,
                "accepted_ip" character varying(64),
                "accepted_user_agent" character varying(300),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_be6f2a6075852cfee2cf15d0a95" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_whatsapp_consent_links_client" ON "whatsapp_consent_links" ("client_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "clients"
            ADD "whatsapp_opt_in_source" character varying(10)
        `);
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links"
            ADD CONSTRAINT "FK_eea9a712c1402846711f74864bf" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links"
            ADD CONSTRAINT "FK_8dcc13907a1b27302d910410d23" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links"
            ADD CONSTRAINT "FK_49feb65ba9275e8884d4ce7b667" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links" DROP CONSTRAINT "FK_49feb65ba9275e8884d4ce7b667"
        `);
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links" DROP CONSTRAINT "FK_8dcc13907a1b27302d910410d23"
        `);
    await queryRunner.query(`
            ALTER TABLE "whatsapp_consent_links" DROP CONSTRAINT "FK_eea9a712c1402846711f74864bf"
        `);
    await queryRunner.query(`
            ALTER TABLE "clients" DROP COLUMN "whatsapp_opt_in_source"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_whatsapp_consent_links_client"
        `);
    await queryRunner.query(`
            DROP TABLE "whatsapp_consent_links"
        `);
  }
}
