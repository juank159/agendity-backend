import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 9.01 (D-17): origen de cada cita, `appointments.source` (`APP` = la
 * crea el negocio; `WEB` = reserva pública por el link). Las citas existentes
 * quedan `APP` por el DEFAULT (no se reescribe ningún valor existente). `down`
 * borra la columna.
 */
export class AppointmentSource1793330990164 implements MigrationInterface {
  name = 'AppointmentSource1793330990164';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "source" character varying(10) NOT NULL DEFAULT 'APP'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "source"`);
  }
}
