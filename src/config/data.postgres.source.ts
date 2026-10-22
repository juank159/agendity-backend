// src/config/data.postgres.source.ts
import { join } from 'path';
import { DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';

config();
const configService = new ConfigService();

// Con ts-node (CLI de migraciones) o ts-jest este archivo es `src/config/*.ts`;
// en runtime es `dist/config/*.js`. Las rutas salen de aquí para que valgan en
// los dos casos y no carguen los `.d.ts` de `dist`.
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

/**
 * Configuración única de TypeORM: la usan `AppModule` (TypeOrmModule) y el CLI
 * de migraciones (`src/data-source.ts`).
 *
 * El esquema SOLO cambia con migraciones (`src/migrations/`), nunca con
 * `synchronize`. `migrationsRun` aplica las migraciones pendientes al arrancar
 * únicamente si `DB_MIGRATIONS_RUN=true` (pensado para el despliegue); en
 * desarrollo se aplican a mano con `npm run migration:run`.
 */
export const DataSourceConfig: DataSourceOptions = {
  type: 'postgres',
  host: configService.get('DB_HOST'),
  port: configService.get('DB_PORT'),
  username: configService.get('DB_USERNAME'),
  password: configService.get('DB_PASSWORD'),
  database: configService.get('DB_NAME'),
  entities: [join(__dirname, '..', '**', `*.entity.${ext}`)],
  migrations: [join(__dirname, '..', 'migrations', `*.${ext}`)],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: ['error'],
  migrationsRun: configService.get('DB_MIGRATIONS_RUN') === 'true',
};
