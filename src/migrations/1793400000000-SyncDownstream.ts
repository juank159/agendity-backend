import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 10.01a (D-18): bajada de cambios para la app sin conexión.
 *
 * - `sync_tenant_version`: versión monotónica por negocio. `sync_next_version`
 *   la sube con `INSERT … ON CONFLICT DO UPDATE`, que bloquea la fila del
 *   negocio hasta el commit: una versión mayor nunca se confirma antes que una
 *   menor, así que un cursor por versión no se salta filas.
 * - `sync_version` (bigint) en cada tabla que se sincroniza, puesta por un
 *   trigger `BEFORE INSERT OR UPDATE` (cubre también el SQL crudo), con índice
 *   `(negocio, sync_version)`. Las líneas de cita (`appointment_services`)
 *   suben la versión de su cita (son parte de ella).
 * - `owner_id` en `schedules`, `time_block`, `user_services` y
 *   `notifications`, rellenado por trigger desde el profesional o el receptor
 *   (el código no tiene que ponerlo). `created_at`/`updated_at` en
 *   `time_block`.
 * - `sync_tombstones`: registro de borrados (`kind = delete`) y de salidas
 *   del alcance de un empleado (`kind = leave_scope`: una cita o un bloqueo
 *   que cambia de profesional), con su versión.
 *
 * Datos existentes: NO se modifica ningún valor. Se añaden columnas y se
 * rellenan (`owner_id`, `sync_version`); el relleno hace un UPDATE de cada fila
 * que solo escribe esas columnas nuevas (`updated_at` no lo toca: no hay
 * trigger que lo actualice). `down` lo quita todo.
 */

/** Tablas sincronizadas: [tabla, columna del negocio, columna id]. */
const SYNCED: [string, string, string][] = [
  ['clients', 'owner_id', 'id'],
  ['appointments', 'owner_id', 'id'],
  ['payments', 'owner_id', 'id'],
  ['custom_payment_methods', 'owner_id', 'id'],
  ['services', 'owner_id', 'id'],
  ['categories', 'owner_id', 'id'],
  ['user_services', 'owner_id', 'id'],
  ['schedules', 'owner_id', 'id'],
  ['time_block', 'owner_id', 'id'],
  ['reviews', 'owner_id', 'id'],
  ['users', 'tenant_id', 'id'],
  ['business_settings', 'tenant_id', 'tenant_id'],
  ['notifications', 'owner_id', 'id'],
];

/** Columna de alcance de los registros que ven solo algunos (para el registro de borrados). */
const SCOPE: Record<string, string> = {
  appointments: 'professional_id',
  time_block: 'userId',
  notifications: 'receiver_id',
};

/** Tablas a las que se añade `owner_id`, con la columna del usuario de la que sale. */
const OWNER_FROM_USER: [string, string][] = [
  ['schedules', 'userId'],
  ['time_block', 'userId'],
  ['user_services', 'user_id'],
];

export class SyncDownstream1793400000000 implements MigrationInterface {
  name = 'SyncDownstream1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const q = (sql: string) => queryRunner.query(sql);

    await q(`
      CREATE TABLE "sync_tenant_version" (
        "tenant_id" uuid PRIMARY KEY,
        "version" bigint NOT NULL DEFAULT 0
      )`);
    await q(`
      CREATE TABLE "sync_tombstones" (
        "id" bigserial PRIMARY KEY,
        "tenant_id" uuid NOT NULL,
        "entity" character varying(40) NOT NULL,
        "entity_id" uuid NOT NULL,
        "version" bigint NOT NULL,
        "kind" character varying(12) NOT NULL,
        "scope_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);
    await q(
      `CREATE INDEX "IDX_sync_tombstones_tenant_version" ON "sync_tombstones" ("tenant_id", "version")`,
    );

    await q(`
      CREATE FUNCTION sync_next_version(t uuid) RETURNS bigint AS $$
        INSERT INTO sync_tenant_version (tenant_id, version) VALUES (t, 1)
        ON CONFLICT (tenant_id)
        DO UPDATE SET version = sync_tenant_version.version + 1
        RETURNING version
      $$ LANGUAGE sql`);

    // BEFORE INSERT/UPDATE: versión nueva del negocio de la fila.
    await q(`
      CREATE FUNCTION sync_bump() RETURNS trigger AS $$
      DECLARE t uuid;
      BEGIN
        t := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
        IF t IS NOT NULL THEN
          NEW.sync_version := sync_next_version(t);
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);

    // AFTER DELETE: tombstone con la versión siguiente.
    await q(`
      CREATE FUNCTION sync_tombstone() RETURNS trigger AS $$
      DECLARE t uuid; old_row jsonb := to_jsonb(OLD);
      BEGIN
        t := (old_row ->> TG_ARGV[0])::uuid;
        IF t IS NOT NULL THEN
          INSERT INTO sync_tombstones (tenant_id, entity, entity_id, version, kind, scope_user_id)
          VALUES (t, TG_TABLE_NAME, (old_row ->> TG_ARGV[1])::uuid,
                  sync_next_version(t), 'delete',
                  CASE WHEN TG_NARGS > 2 THEN (old_row ->> TG_ARGV[2])::uuid END);
        END IF;
        RETURN OLD;
      END $$ LANGUAGE plpgsql`);

    // AFTER UPDATE: si cambia el profesional, el anterior deja de verla.
    await q(`
      CREATE FUNCTION sync_leave_scope() RETURNS trigger AS $$
      DECLARE before_user uuid := (to_jsonb(OLD) ->> TG_ARGV[1])::uuid;
              after_user uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
              t uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
      BEGIN
        IF t IS NOT NULL AND before_user IS NOT NULL
           AND before_user IS DISTINCT FROM after_user THEN
          INSERT INTO sync_tombstones (tenant_id, entity, entity_id, version, kind, scope_user_id)
          VALUES (t, TG_TABLE_NAME, NEW.id, sync_next_version(t), 'leave_scope', before_user);
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);

    // Líneas de cita: cualquier cambio sube la versión de su cita.
    await q(`
      CREATE FUNCTION sync_touch_appointment() RETURNS trigger AS $$
      BEGIN
        UPDATE appointments SET sync_version = sync_version
         WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.appointment_id ELSE NEW.appointment_id END;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);

    // `owner_id` desde el usuario (profesional) de la fila.
    await q(`
      CREATE FUNCTION sync_owner_from_user() RETURNS trigger AS $$
      DECLARE u uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
      BEGIN
        IF TG_OP = 'INSERT' OR NEW.owner_id IS NULL
           OR u IS DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[0])::uuid THEN
          NEW.owner_id := (SELECT tenant_id FROM users WHERE id = u);
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);

    // `owner_id` de una notificación: el negocio del usuario o del cliente receptor.
    await q(`
      CREATE FUNCTION sync_owner_of_notification() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' OR NEW.owner_id IS NULL
           OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN
          NEW.owner_id := CASE
            WHEN NEW.receiver_type::text = 'CLIENT'
              THEN (SELECT owner_id FROM clients WHERE id = NEW.receiver_id)
            ELSE (SELECT tenant_id FROM users WHERE id = NEW.receiver_id)
          END;
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);

    // Columnas nuevas.
    for (const [table] of OWNER_FROM_USER) {
      await q(`ALTER TABLE "${table}" ADD "owner_id" uuid`);
    }
    await q(`ALTER TABLE "notifications" ADD "owner_id" uuid`);
    await q(
      `ALTER TABLE "time_block" ADD "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    await q(
      `ALTER TABLE "time_block" ADD "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`,
    );
    for (const [table, tenant] of SYNCED) {
      await q(`ALTER TABLE "${table}" ADD "sync_version" bigint`);
      await q(
        `CREATE INDEX "IDX_sync_${table}" ON "${table}" ("${tenant}", "sync_version")`,
      );
    }

    // Triggers (los BEFORE se ejecutan por orden alfabético: primero el
    // `owner_id`, después la versión).
    for (const [table, userCol] of OWNER_FROM_USER) {
      await q(`CREATE TRIGGER "sync_a_owner" BEFORE INSERT OR UPDATE ON "${table}"
               FOR EACH ROW EXECUTE FUNCTION sync_owner_from_user('${userCol}')`);
    }
    await q(`CREATE TRIGGER "sync_a_owner" BEFORE INSERT OR UPDATE ON "notifications"
             FOR EACH ROW EXECUTE FUNCTION sync_owner_of_notification()`);
    for (const [table, tenant, id] of SYNCED) {
      await q(`CREATE TRIGGER "sync_b_version" BEFORE INSERT OR UPDATE ON "${table}"
               FOR EACH ROW EXECUTE FUNCTION sync_bump('${tenant}')`);
      const scope = SCOPE[table] ? `, '${SCOPE[table]}'` : '';
      await q(`CREATE TRIGGER "sync_c_tombstone" AFTER DELETE ON "${table}"
               FOR EACH ROW EXECUTE FUNCTION sync_tombstone('${tenant}', '${id}'${scope})`);
    }
    for (const table of ['appointments', 'time_block']) {
      await q(`CREATE TRIGGER "sync_d_leave_scope" AFTER UPDATE ON "${table}"
               FOR EACH ROW EXECUTE FUNCTION sync_leave_scope('owner_id', '${SCOPE[table]}')`);
    }
    await q(`CREATE TRIGGER "sync_touch_appointment" AFTER INSERT OR UPDATE OR DELETE
             ON "appointment_services"
             FOR EACH ROW EXECUTE FUNCTION sync_touch_appointment()`);

    // Relleno: un UPDATE por fila dispara los triggers (owner_id y versión).
    for (const [table] of SYNCED) {
      await q(`UPDATE "${table}" SET "sync_version" = NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const q = (sql: string) => queryRunner.query(sql);
    await q(
      `DROP TRIGGER IF EXISTS "sync_touch_appointment" ON "appointment_services"`,
    );
    for (const table of ['appointments', 'time_block']) {
      await q(`DROP TRIGGER IF EXISTS "sync_d_leave_scope" ON "${table}"`);
    }
    for (const [table] of SYNCED) {
      await q(`DROP TRIGGER IF EXISTS "sync_c_tombstone" ON "${table}"`);
      await q(`DROP TRIGGER IF EXISTS "sync_b_version" ON "${table}"`);
      await q(`DROP INDEX IF EXISTS "IDX_sync_${table}"`);
      await q(`ALTER TABLE "${table}" DROP COLUMN "sync_version"`);
    }
    for (const [table] of OWNER_FROM_USER) {
      await q(`DROP TRIGGER IF EXISTS "sync_a_owner" ON "${table}"`);
      await q(`ALTER TABLE "${table}" DROP COLUMN "owner_id"`);
    }
    await q(`DROP TRIGGER IF EXISTS "sync_a_owner" ON "notifications"`);
    await q(`ALTER TABLE "notifications" DROP COLUMN "owner_id"`);
    await q(`ALTER TABLE "time_block" DROP COLUMN "updated_at"`);
    await q(`ALTER TABLE "time_block" DROP COLUMN "created_at"`);
    for (const fn of [
      'sync_owner_of_notification()',
      'sync_owner_from_user()',
      'sync_touch_appointment()',
      'sync_leave_scope()',
      'sync_tombstone()',
      'sync_bump()',
      'sync_next_version(uuid)',
    ]) {
      await q(`DROP FUNCTION IF EXISTS ${fn}`);
    }
    await q(`DROP TABLE "sync_tombstones"`);
    await q(`DROP TABLE "sync_tenant_version"`);
  }
}
