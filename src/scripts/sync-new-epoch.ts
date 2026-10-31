/**
 * Runbook (2026-11-01): después de RESTAURAR un respaldo de la base, cambiar el
 * `epoch` de sincronización para que todas las apps vuelvan a bajar todo
 * (sus cursores apuntan a versiones que la base restaurada no conoce).
 *
 *   npm run sync:new-epoch            (usa la base del .env)
 *   DB_NAME=otra npm run sync:new-epoch
 *
 * Solo cambia `sync_meta.epoch`; imprime el epoch nuevo (no es un secreto).
 */
import { AppDataSource } from '../data-source';

async function main() {
  await AppDataSource.initialize();
  try {
    const [row] = await AppDataSource.query(
      `INSERT INTO sync_meta (key, value) VALUES ('epoch', uuid_generate_v4()::text)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
       RETURNING value`,
    );
    console.log(`Nuevo epoch de sincronización: ${row.value}`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(`No se pudo cambiar el epoch: ${error.message}`);
  process.exit(1);
});
