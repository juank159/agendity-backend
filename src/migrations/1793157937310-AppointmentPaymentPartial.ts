import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2.24 (anticipos): `appointments.payment_status` admite `PARTIAL` (pagado
 * menos que el total). El enum se recrea (como lo haría `migration:generate`)
 * en vez de `ALTER TYPE … ADD VALUE`, porque un valor añadido así no se puede
 * usar en la misma transacción y la migración lo necesita para los datos.
 *
 * Datos (up): las citas `COMPLETED` cuyo pagado neto (pagos COMPLETED,
 * `amount − refund_amount`) es menor que `total_price` pasan a `PARTIAL`
 * (antes de 2.24 un anticipo o un reembolso parcial dejaban la cita en
 * COMPLETED). Ninguna otra fila cambia.
 * Down: `PARTIAL` → `COMPLETED` (como se guardaba antes) y el enum anterior.
 */
export class AppointmentPaymentPartial1793157937310
  implements MigrationInterface
{
  name = 'AppointmentPaymentPartial1793157937310';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TYPE "public"."appointments_payment_status_enum"
            RENAME TO "appointments_payment_status_enum_old"
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."appointments_payment_status_enum" AS ENUM(
                'PENDING',
                'PARTIAL',
                'COMPLETED',
                'FAILED',
                'REFUNDED',
                'CANCELLED'
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status" DROP DEFAULT
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status" TYPE "public"."appointments_payment_status_enum" USING "payment_status"::"text"::"public"."appointments_payment_status_enum"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status"
            SET DEFAULT 'PENDING'
        `);
    await queryRunner.query(`
            DROP TYPE "public"."appointments_payment_status_enum_old"
        `);
    await queryRunner.query(`
            UPDATE "appointments" a
               SET "payment_status" = 'PARTIAL'
              FROM (
                    SELECT p."appointmentId" AS id,
                           SUM(p.amount - COALESCE(p.refund_amount, 0)) AS paid
                      FROM "payments" p
                     WHERE p.status = 'COMPLETED'
                     GROUP BY p."appointmentId"
                   ) s
             WHERE s.id = a.id
               AND a."payment_status" = 'COMPLETED'
               AND s.paid > 0
               AND s.paid < a.total_price
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            UPDATE "appointments"
               SET "payment_status" = 'COMPLETED'
             WHERE "payment_status" = 'PARTIAL'
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."appointments_payment_status_enum_old" AS ENUM(
                'PENDING',
                'COMPLETED',
                'FAILED',
                'REFUNDED',
                'CANCELLED'
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status" DROP DEFAULT
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status" TYPE "public"."appointments_payment_status_enum_old" USING "payment_status"::"text"::"public"."appointments_payment_status_enum_old"
        `);
    await queryRunner.query(`
            ALTER TABLE "appointments"
            ALTER COLUMN "payment_status"
            SET DEFAULT 'PENDING'
        `);
    await queryRunner.query(`
            DROP TYPE "public"."appointments_payment_status_enum"
        `);
    await queryRunner.query(`
            ALTER TYPE "public"."appointments_payment_status_enum_old"
            RENAME TO "appointments_payment_status_enum"
        `);
  }
}
