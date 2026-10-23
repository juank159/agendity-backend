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
