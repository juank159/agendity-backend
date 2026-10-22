import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.01: el tenant de un negocio es el id de su Owner.
 *
 * Antes: el Owner tenía en `users.tenant_id` un uuid aleatorio (distinto de su id)
 * y los empleados quedaban con `tenant_id = NULL`. Las suscripciones creadas al
 * registrarse usaban ese uuid aleatorio; las creadas al agendar, el id del Owner.
 *
 * Esta migración (solo datos, sin cambios de esquema):
 * 1. Suscripciones y pagos de suscripción: si un Owner NO tiene ninguna
 *    suscripción con su id, las que están con su uuid antiguo pasan a su id.
 *    Si ya tiene una con su id, las antiguas se dejan como están (la 2.03 decide).
 * 2. `users.tenant_id` = id del owner (empleados) o el propio id (resto).
 *
 * Los valores anteriores se guardan en `migration_backup_tenant_ids` para que
 * `down` los restaure exactamente. Esa tabla no es de ninguna entidad.
 */
export class TenantIdFromOwner1792647809983 implements MigrationInterface {
  name = 'TenantIdFromOwner1792647809983';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "migration_backup_tenant_ids" (
        "kind" character varying NOT NULL,
        "id" uuid NOT NULL,
        "old_tenant_id" uuid,
        CONSTRAINT "PK_migration_backup_tenant_ids" PRIMARY KEY ("kind", "id")
      )
    `);

    // Owners cuyo uuid antiguo hay que llevar a su id: no tienen ya una
    // suscripción con su id.
    const rekey = `
      SELECT u."id" AS owner_id, u."tenant_id" AS old_tenant_id
      FROM "users" u
      WHERE u."owner_id" IS NULL
        AND u."tenant_id" IS NOT NULL
        AND u."tenant_id" <> u."id"
        AND NOT EXISTS (
          SELECT 1 FROM "subscriptions" s WHERE s."tenant_id" = u."id"
        )
    `;

    await queryRunner.query(`
      INSERT INTO "migration_backup_tenant_ids" ("kind", "id", "old_tenant_id")
      SELECT 'subscriptions', s."id", s."tenant_id"
      FROM "subscriptions" s JOIN (${rekey}) r ON s."tenant_id" = r.old_tenant_id
    `);
    await queryRunner.query(`
      INSERT INTO "migration_backup_tenant_ids" ("kind", "id", "old_tenant_id")
      SELECT 'payment_history', p."id", p."tenant_id"
      FROM "payment_history" p JOIN (${rekey}) r ON p."tenant_id" = r.old_tenant_id
    `);
    await queryRunner.query(`
      UPDATE "payment_history" p SET "tenant_id" = r.owner_id
      FROM (${rekey}) r WHERE p."tenant_id" = r.old_tenant_id
    `);
    // Las suscripciones al final: el NOT EXISTS de `rekey` las mira.
    await queryRunner.query(`
      UPDATE "subscriptions" s SET "tenant_id" = r.owner_id
      FROM (${rekey}) r WHERE s."tenant_id" = r.old_tenant_id
    `);

    await queryRunner.query(`
      INSERT INTO "migration_backup_tenant_ids" ("kind", "id", "old_tenant_id")
      SELECT 'users', u."id", u."tenant_id"
      FROM "users" u
      WHERE u."tenant_id" IS DISTINCT FROM COALESCE(u."owner_id", u."id")
    `);
    await queryRunner.query(`
      UPDATE "users" SET "tenant_id" = COALESCE("owner_id", "id")
      WHERE "tenant_id" IS DISTINCT FROM COALESCE("owner_id", "id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" u SET "tenant_id" = b."old_tenant_id"
      FROM "migration_backup_tenant_ids" b
      WHERE b."kind" = 'users' AND b."id" = u."id"
    `);
    await queryRunner.query(`
      UPDATE "subscriptions" s SET "tenant_id" = b."old_tenant_id"
      FROM "migration_backup_tenant_ids" b
      WHERE b."kind" = 'subscriptions' AND b."id" = s."id"
    `);
    await queryRunner.query(`
      UPDATE "payment_history" p SET "tenant_id" = b."old_tenant_id"
      FROM "migration_backup_tenant_ids" b
      WHERE b."kind" = 'payment_history' AND b."id" = p."id"
    `);
    await queryRunner.query(`DROP TABLE "migration_backup_tenant_ids"`);
  }
}
