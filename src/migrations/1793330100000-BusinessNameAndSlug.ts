import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 8.00: nombre del negocio (`business_settings.name`, texto libre) y el
 * slug del link público (`slug`, único, para la Fase 9). Solo añade columnas
 * vacías (NULL): no modifica datos. `down` las borra.
 */
export class BusinessNameAndSlug1793330100000 implements MigrationInterface {
  name = 'BusinessNameAndSlug1793330100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" ADD "name" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_settings" ADD "slug" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_settings" ADD CONSTRAINT "UQ_51adcad5f607d9dbc7c6157035c" UNIQUE ("slug")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" DROP CONSTRAINT "UQ_51adcad5f607d9dbc7c6157035c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_settings" DROP COLUMN "slug"`,
    );
    await queryRunner.query(
      `ALTER TABLE "business_settings" DROP COLUMN "name"`,
    );
  }
}
