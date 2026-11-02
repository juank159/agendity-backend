import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 12.01 (D-22): paleta de color del negocio, `business_settings.theme_palette`.
 * Solo añade la columna (nula = lavanda, por defecto): no transforma datos.
 * Los valores válidos los controla el código (`settings/theme-palette.ts`).
 */
export class BusinessThemePalette1793490000000 implements MigrationInterface {
  name = 'BusinessThemePalette1793490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" ADD "theme_palette" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" DROP COLUMN "theme_palette"`,
    );
  }
}
