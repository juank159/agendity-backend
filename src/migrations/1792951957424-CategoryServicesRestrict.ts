import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2.21: borrar una categoría ya no borra sus servicios en cascada.
 * `services.category_id` pasa de ON DELETE CASCADE a RESTRICT. Solo cambia la
 * restricción: no transforma ni borra datos.
 */
export class CategoryServicesRestrict1792951957424
  implements MigrationInterface
{
  name = 'CategoryServicesRestrict1792951957424';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "services" DROP CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec"
        `);
    await queryRunner.query(`
            ALTER TABLE "services"
            ADD CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "services" DROP CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec"
        `);
    await queryRunner.query(`
            ALTER TABLE "services"
            ADD CONSTRAINT "FK_1f8d1173481678a035b4a81a4ec" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }
}
