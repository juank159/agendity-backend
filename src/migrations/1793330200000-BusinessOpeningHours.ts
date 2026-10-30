import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 8.01: horario de apertura del negocio (`business_settings.opening_hours`,
 * jsonb). NULL = sin configurar: el negocio se comporta como antes (sin límite
 * extra). Solo añade la columna; no modifica datos. `down` la borra.
 */
export class BusinessOpeningHours1793330200000 implements MigrationInterface {
  name = 'BusinessOpeningHours1793330200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" ADD "opening_hours" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "business_settings" DROP COLUMN "opening_hours"`,
    );
  }
}
