import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `sync_meta` (2026-11-01): metadatos de la sincronización. Hoy, `epoch`: un
 * UUID propio de ESTA base, creado una vez. `GET /sync/changes` lo devuelve
 * para que la app detecte que el servidor es otro (o fue restaurado) y vuelva
 * a bajar todo. Tras restaurar un respaldo se cambia con
 * `npm run sync:new-epoch` (paso del runbook). No toca datos existentes.
 */
export class SyncMeta1793430000000 implements MigrationInterface {
  name = 'SyncMeta1793430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sync_meta" (
        "key" character varying(40) PRIMARY KEY,
        "value" text NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(
      `INSERT INTO "sync_meta" ("key", "value") VALUES ('epoch', uuid_generate_v4()::text)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sync_meta"`);
  }
}
