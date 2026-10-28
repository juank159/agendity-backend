/**
 * Tests e2e que ESCRIBEN de verdad: solo contra una copia temporal de la BD.
 * Se activan con `E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`; nunca con
 * `ecommerce`. En la corrida normal salen como omitidos.
 */
import { DataSource } from 'typeorm';

export const WRITABLE_DB = process.env.E2E_WRITABLE_DB;

export const RUN_WRITES =
  !!WRITABLE_DB &&
  WRITABLE_DB !== 'ecommerce' &&
  process.env.DB_NAME === WRITABLE_DB;

/** `describe` si hay copia escribible; `describe.skip` si no. */
export const describeWritable: jest.Describe = RUN_WRITES
  ? describe
  : describe.skip;

/** Antes de escribir: la conexión real debe ser la copia (nunca `ecommerce`). */
export async function assertWritableDatabase(ds: DataSource): Promise<void> {
  const [{ db }] = await ds.query('SELECT current_database() AS db');
  if (!RUN_WRITES || db !== WRITABLE_DB || db === 'ecommerce') {
    throw new Error(`Base inesperada para escribir: ${db}`);
  }
}

/**
 * Precondición de suscripción para un spec que escribe: el negocio `tenantId`
 * en trial, sin plan ni fechas, con `used` citas gastadas de `limit`. Cada spec
 * la fija en su `beforeAll`: así no depende del orden ni de otros specs.
 */
export async function resetTrialQuota(
  ds: DataSource,
  tenantId: string,
  { used = 0, limit = 20 }: { used?: number; limit?: number } = {},
): Promise<void> {
  await assertWritableDatabase(ds);
  await ds.query(
    `UPDATE subscriptions
        SET status = 'trial', plan_id = NULL,
            subscription_start_date = NULL, subscription_end_date = NULL,
            trial_appointments_used = $2, trial_appointments_limit = $3,
            is_trial_used = false
      WHERE tenant_id = $1`,
    [tenantId, used, limit],
  );
}

/**
 * Fechas de citas y bloqueos de prueba (2.21: solo se agenda a futuro).
 * Base: lunes 2100-01-04 00:00 UTC. Cada spec pide su primera semana libre
 * (después de toda cita o bloqueo de la copia) y avanza desde ahí: no choca
 * con corridas anteriores ni con otros specs (un solo worker: `--maxWorkers=1`).
 */
export const FUTURE_BASE_MONDAY = Date.UTC(2100, 0, 4);
export const WEEK_MS = 7 * 24 * 3_600_000;

/** Índice (≥ 1) de la primera semana sin citas ni bloqueos desde la base. */
export async function firstFreeWeek(ds: DataSource): Promise<number> {
  const [{ last }] = await ds.query(
    `SELECT GREATEST((SELECT max(date) FROM appointments),
                     (SELECT max(end_datetime) FROM time_block)) AS last`,
  );
  const elapsed = last ? new Date(last).getTime() - FUTURE_BASE_MONDAY : -1;
  return elapsed < 0 ? 1 : Math.floor(elapsed / WEEK_MS) + 1;
}

/** Lunes 00:00 UTC de la semana `week` (Bogotá: domingo 19:00). */
export function futureMonday(week: number): number {
  return FUTURE_BASE_MONDAY + week * WEEK_MS;
}
