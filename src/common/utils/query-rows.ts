/**
 * Filas de un `dataSource.query` con `RETURNING`. Con Postgres, TypeORM
 * devuelve las filas tal cual en un INSERT, pero `[filas, nº afectadas]` en un
 * UPDATE o DELETE: esta función da siempre las filas.
 */
export function returnedRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (result ?? []) as T[];
}
