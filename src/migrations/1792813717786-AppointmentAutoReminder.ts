import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.09a: recordatorios automáticos desde la BD (cron por minuto).
 *
 * - `appointments.auto_reminder_for`: la fecha de la cita para la que ya se
 *   procesó el recordatorio automático. NULL en todas las filas existentes
 *   (ninguna cita tiene aún recordatorio automático registrado). El cron la
 *   escribe con un UPDATE condicional: idempotente aunque el servidor se
 *   reinicie o haya dos instancias.
 * - `IDX_appointments_date`: el cron consulta cada minuto las citas de la
 *   próxima hora.
 *
 * Sin pérdida de datos en `up` ni en `down` (la columna nueva solo guarda
 * marcas del cron).
 */
export class AppointmentAutoReminder1792813717786
  implements MigrationInterface
{
  name = 'AppointmentAutoReminder1792813717786';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "appointments" ADD "auto_reminder_for" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_appointments_date" ON "appointments" ("date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "public"."IDX_appointments_date"
    `);
    await queryRunner.query(`
      ALTER TABLE "appointments" DROP COLUMN "auto_reminder_for"
    `);
  }
}
