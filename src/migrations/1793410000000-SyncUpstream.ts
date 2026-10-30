import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 10.01b (D-18): subida de cambios hechos sin conexión.
 * - `sync_mutations`: una fila por mutación recibida (idempotencia por
 *   `mutation_id`: la misma mutación devuelve el mismo resultado).
 * - `sync_id_aliases`: id que el dispositivo dio a un cliente que el servidor
 *   fusionó con otro (mismo teléfono) → id con el que quedó. Las mutaciones
 *   que llegan con el id viejo se aplican al nuevo.
 * - `appointments.sync_conflict` / `needs_reschedule`: cita guardada aunque
 *   chocaba; no ocupa hueco hasta que se mueva.
 * - `payments.review_required`: pago guardado aunque no cabía (cita cancelada
 *   o más que el total); no cuenta en lo pagado hasta resolverlo.
 * Solo añade tablas y columnas (las nuevas columnas nacen vacías / false): no
 * modifica datos existentes. `down` las quita.
 */
export class SyncUpstream1793410000000 implements MigrationInterface {
  name = 'SyncUpstream1793410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const q = (sql: string) => queryRunner.query(sql);
    await q(`
      CREATE TABLE "sync_mutations" (
        "mutation_id" uuid PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "device_id" character varying(100),
        "type" character varying(40) NOT NULL,
        "entity_id" uuid,
        "status" character varying(12) NOT NULL,
        "result" jsonb,
        "client_time" TIMESTAMP WITH TIME ZONE,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await q(
      `CREATE INDEX "IDX_sync_mutations_tenant" ON "sync_mutations" ("tenant_id", "received_at")`,
    );
    await q(`
      CREATE TABLE "sync_id_aliases" (
        "tenant_id" uuid NOT NULL,
        "entity" character varying(40) NOT NULL,
        "alias_id" uuid NOT NULL,
        "target_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        PRIMARY KEY ("entity", "alias_id")
      )`);
    await q(
      `ALTER TABLE "appointments" ADD "sync_conflict" character varying(40)`,
    );
    await q(
      `ALTER TABLE "appointments" ADD "needs_reschedule" boolean NOT NULL DEFAULT false`,
    );
    await q(
      `ALTER TABLE "payments" ADD "review_required" character varying(40)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const q = (sql: string) => queryRunner.query(sql);
    await q(`ALTER TABLE "payments" DROP COLUMN "review_required"`);
    await q(`ALTER TABLE "appointments" DROP COLUMN "needs_reschedule"`);
    await q(`ALTER TABLE "appointments" DROP COLUMN "sync_conflict"`);
    await q(`DROP TABLE "sync_id_aliases"`);
    await q(`DROP TABLE "sync_mutations"`);
  }
}
