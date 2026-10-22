// DataSource del CLI de TypeORM (scripts `migration:*` de package.json).
// Reutiliza la misma configuración que la app; el CLI nunca debe migrar solo.
import { DataSource } from 'typeorm';
import { DataSourceConfig } from './config/data.postgres.source';

export const AppDataSource = new DataSource({
  ...DataSourceConfig,
  migrationsRun: false,
});
