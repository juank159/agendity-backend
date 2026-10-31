import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La bajada de la empleada se limita a sus filas de `user_services`,
 * `schedules` y `users` (como la API, 6389bef). Para eso sus tombstones guardan
 * el usuario (`scope_user_id`) y, si una asignación u horario cambia de
 * profesional, el anterior recibe `leave_scope` (como las citas).
 * Solo cambia triggers: no toca datos. Los tombstones ya guardados de estas
 * tablas no tienen usuario: el Owner los sigue recibiendo; la empleada no.
 */
const TABLES: [string, string, string][] = [
  // [tabla, columna del negocio, columna del usuario]
  ['user_services', 'owner_id', 'user_id'],
  ['schedules', 'owner_id', 'userId'],
  ['users', 'tenant_id', 'id'],
];

export class SyncEmployeeScope1793420000000 implements MigrationInterface {
  name = 'SyncEmployeeScope1793420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, tenant, user] of TABLES) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "sync_c_tombstone" ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE TRIGGER "sync_c_tombstone" AFTER DELETE ON "${table}"
         FOR EACH ROW EXECUTE FUNCTION sync_tombstone('${tenant}', 'id', '${user}')`,
      );
      if (table !== 'users') {
        await queryRunner.query(
          `CREATE TRIGGER "sync_d_leave_scope" AFTER UPDATE ON "${table}"
           FOR EACH ROW EXECUTE FUNCTION sync_leave_scope('${tenant}', '${user}')`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, tenant] of TABLES) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "sync_d_leave_scope" ON "${table}"`,
      );
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "sync_c_tombstone" ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE TRIGGER "sync_c_tombstone" AFTER DELETE ON "${table}"
         FOR EACH ROW EXECUTE FUNCTION sync_tombstone('${tenant}', 'id')`,
      );
    }
  }
}
