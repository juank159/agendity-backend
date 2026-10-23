import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea 2.05: todas las fechas pasan a `timestamptz` (instantes) sin mover el
 * momento real que representan.
 *
 * Las 23 columnas `timestamp` sin zona tenían DOS orígenes, y por eso dos zonas
 * distintas (comprobado con los datos de desarrollo):
 *
 * - Escritas por Postgres (`DEFAULT now()`, y `CURRENT_TIMESTAMP` que pone
 *   TypeORM en `@UpdateDateColumn`/`softDelete`): guardan la hora de pared de la
 *   sesión, que es UTC (`TimeZone = Etc/UTC` en el servidor; el driver no la
 *   cambia). Prueba: `users.created_at` del Employee = `schedules.created_at`
 *   (timestamptz) de la misma alta, al microsegundo.
 * - Escritas desde Node con un `Date`: node-postgres lo manda en la hora local
 *   del proceso con offset y Postgres descarta el offset → hora de pared de
 *   Bogotá (el backend solo ha corrido en el Mac de desarrollo, en
 *   America/Bogota). Prueba: suscripción 18da93eb, `subscription_start_date`
 *   16:50:09.393 (Node) y `updated_at` 21:50:09.395 (Postgres) en la misma
 *   operación: 5 h exactas.
 *
 * Además, `payments.created_at/updated_at` (ya `timestamptz`) se guardaban 5 h
 * antes del instante real por el "parche" `NOW() AT TIME ZONE 'UTC' - 5 h` de
 * `PaymentsService.create`; aquí se corrigen (+5 h) y reciben `DEFAULT now()`
 * (el parche y el `@BeforeInsert` de −6 h se retiraron del código).
 *
 * `down` deja cada columna exactamente como estaba (mismo tipo y misma hora de
 * pared) y vuelve a restar las 5 h de `payments`.
 */

/** Zona del proceso Node que escribió los `Date` antes de 2.05. */
const LEGACY_NODE_ZONE = 'America/Bogota';
/** Zona de la sesión de Postgres cuando escribía `now()`. */
const LEGACY_DB_ZONE = 'UTC';

/** [tabla, columnas escritas por Postgres (UTC), columnas escritas por Node (Bogotá)] */
const COLUMNS: [string, string[], string[]][] = [
  ['appointments', ['created_at', 'updated_at'], ['date']],
  ['categories', ['created_at', 'updated_at'], []],
  ['services', ['created_at', 'updated_at'], []],
  ['subscription_plans', ['created_at', 'updated_at'], []],
  [
    'subscriptions',
    ['created_at', 'updated_at'],
    ['subscription_start_date', 'subscription_end_date'],
  ],
  ['payment_history', ['created_at', 'updated_at'], ['payment_date']],
  ['time_block', [], ['start_datetime', 'end_datetime']],
  [
    'users',
    ['created_at', 'updated_at', 'deletedAt'],
    ['verification_code_expires', 'reset_password_expires'],
  ],
];

/** Desfase que el parche de `PaymentsService.create` restaba a `payments.*_at`. */
const PAYMENTS_SHIFT = `interval '5 hours'`;

function alterTable(
  table: string,
  dbColumns: string[],
  nodeColumns: string[],
  type: 'timestamptz' | 'timestamp',
): string {
  const clauses = [
    ...dbColumns.map((c) => [c, LEGACY_DB_ZONE] as const),
    ...nodeColumns.map((c) => [c, LEGACY_NODE_ZONE] as const),
  ].map(
    ([column, zone]) =>
      `ALTER COLUMN "${column}" TYPE ${type} USING "${column}" AT TIME ZONE '${zone}'`,
  );
  return `ALTER TABLE "${table}" ${clauses.join(', ')}`;
}

export class TimestampsToTimestamptz1792651587415
  implements MigrationInterface
{
  name = 'TimestampsToTimestamptz1792651587415';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // timestamp AT TIME ZONE z = "esta hora de pared es de z" → instante.
    for (const [table, dbColumns, nodeColumns] of COLUMNS) {
      await queryRunner.query(
        alterTable(table, dbColumns, nodeColumns, 'timestamptz'),
      );
    }

    await queryRunner.query(
      `UPDATE "payments" SET "created_at" = "created_at" + ${PAYMENTS_SHIFT}, "updated_at" = "updated_at" + ${PAYMENTS_SHIFT}`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "created_at" SET DEFAULT now(), ALTER COLUMN "updated_at" SET DEFAULT now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "created_at" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT`,
    );
    await queryRunner.query(
      `UPDATE "payments" SET "created_at" = "created_at" - ${PAYMENTS_SHIFT}, "updated_at" = "updated_at" - ${PAYMENTS_SHIFT}`,
    );

    // timestamptz AT TIME ZONE z = hora de pared en z (sin zona).
    for (const [table, dbColumns, nodeColumns] of [...COLUMNS].reverse()) {
      await queryRunner.query(
        alterTable(table, dbColumns, nodeColumns, 'timestamp'),
      );
    }
  }
}
