import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.29: cada cita guarda el precio de cada uno de sus servicios
 * (`appointment_services.price`, entidad `AppointmentServiceLine`). Así, cambiar
 * el precio de un servicio no altera el total ni las estadísticas de las citas
 * ya creadas.
 *
 * Las filas existentes se rellenan con el precio ACTUAL del servicio (es lo
 * que usaban hasta ahora las estadísticas por servicio). No modifica ningún
 * dato existente: solo añade la columna. `down` la borra.
 */
export class AppointmentServicePrice1793162605355
  implements MigrationInterface
{
  name = 'AppointmentServicePrice1793162605355';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "appointment_services" ADD "price" numeric(10, 2)
    `);
    await queryRunner.query(`
      UPDATE "appointment_services" aps SET "price" = s."price"
      FROM "services" s WHERE s."id" = aps."service_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "appointment_services" ALTER COLUMN "price" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "appointment_services" DROP COLUMN "price"
    `);
  }
}
