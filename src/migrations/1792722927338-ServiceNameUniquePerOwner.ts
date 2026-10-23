import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.08: el nombre de un servicio pasa de ser único en TODA la app
 * (constraint `UQ_019d74f7abcdcb5a0113010cb03` sobre `name`) a ser único por
 * negocio: índice único `(owner_id, name)`. Dos negocios ya pueden tener un
 * servicio "Corte" cada uno.
 *
 * `up` no puede fallar por datos: lo que era único globalmente también lo es
 * por negocio. `down` vuelve a la regla global y FALLA (23505) si, mientras
 * tanto, dos negocios crearon servicios con el mismo nombre: en ese caso hay
 * que renombrar uno antes de revertir.
 */
export class ServiceNameUniquePerOwner1792722927338
  implements MigrationInterface
{
  name = 'ServiceNameUniquePerOwner1792722927338';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "services" DROP CONSTRAINT "UQ_019d74f7abcdcb5a0113010cb03"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_services_owner_name" ON "services" ("owner_id", "name")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."UQ_services_owner_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "services"
      ADD CONSTRAINT "UQ_019d74f7abcdcb5a0113010cb03" UNIQUE ("name")
    `);
  }
}
