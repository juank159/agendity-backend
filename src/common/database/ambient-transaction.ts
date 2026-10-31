import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';

/**
 * Transacción "ambiente" (2026-11-01, sync/push). Mientras corre
 * `runInAmbientTransaction`, TODO lo que pase por el `DataSource` (sus
 * repositorios inyectados, `dataSource.transaction`, `dataSource.query` y los
 * QueryBuilder) usa la MISMA conexión y la misma transacción. Las
 * `transaction(...)` de los services se anidan como SAVEPOINT (TypeORM 0.3).
 *
 * Así una mutación de la bajada (reservarla, aplicarla con el service de
 * siempre y guardar su resultado) se confirma o se pierde entera: si el
 * proceso muere a mitad, Postgres no confirma nada y el reintento la aplica
 * una sola vez. Fuera de `runInAmbientTransaction` no cambia nada: cada
 * petición sigue usando el pool como siempre (el contexto es por
 * `AsyncLocalStorage`, no global).
 *
 * Prohibido dentro: `dataSource.createQueryRunner()` propio (otra conexión
 * esperaría los locks de esta transacción).
 */
const storage = new AsyncLocalStorage<QueryRunner>();
const installed = new WeakSet<DataSource>();

/** La conexión de la transacción ambiente, si hay una viva. */
function ambientRunner(): QueryRunner | undefined {
  const runner = storage.getStore();
  return runner && !runner.isReleased ? runner : undefined;
}

/** Engancha el `DataSource` (idempotente). */
export function installAmbientTransactions(dataSource: DataSource): void {
  if (installed.has(dataSource)) return;
  installed.add(dataSource);
  // Repositorios inyectados, `dataSource.transaction`, `manager.*` y
  // QueryBuilder resuelven la conexión con `dataSource.manager.queryRunner`.
  Object.defineProperty(dataSource.manager, 'queryRunner', {
    configurable: true,
    get: ambientRunner,
  });
  // `dataSource.query` no pasa por el manager.
  const query = dataSource.query.bind(dataSource);
  dataSource.query = ((sql: string, params?: unknown[], runner?: QueryRunner) =>
    query(sql, params, runner ?? ambientRunner())) as DataSource['query'];
}

/** Ejecuta `work` en una transacción que comparte todo el `DataSource`. */
export async function runInAmbientTransaction<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  installAmbientTransactions(dataSource);
  if (ambientRunner()) {
    throw new Error('Ya hay una transacción ambiente abierta');
  }
  const runner = dataSource.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    const result = await storage.run(runner, () => work(runner.manager));
    await runner.commitTransaction();
    return result;
  } catch (error) {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction().catch(() => undefined);
    }
    throw error;
  } finally {
    await runner.release();
  }
}

/**
 * Dentro de la transacción ambiente: `work` en un SAVEPOINT. Si lanza, se
 * deshace solo lo suyo y la transacción sigue usable (un error de SQL no la
 * deja abortada).
 */
export function inSavepoint<T>(work: () => Promise<T>): Promise<T> {
  const runner = ambientRunner();
  if (!runner) return work();
  return runner.manager.transaction(() => work());
}
