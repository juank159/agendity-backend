/**
 * Arranca la app real (AppModule + setupApp de main.ts) para los tests e2e.
 *
 * Usa el Postgres de desarrollo, pero con `synchronize` y `migrationsRun`
 * desactivados para no tocar el esquema. Los tests solo deben hacer lecturas
 * o peticiones que los guards corten antes del handler.
 */
import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSourceConfig } from '../../src/config/data.postgres.source';

// Debe ir antes de cargar AppModule: AppModule copia esta config al evaluarse.
Object.assign(DataSourceConfig, {
  synchronize: false,
  migrationsRun: false,
  entities: [],
  logging: false,
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupApp } = require('../../src/config/app.setup');

export interface E2EApp {
  app: INestApplication;
  document: OpenAPIObject;
}

export async function createE2EApp(
  extraImports: ModuleMetadata['imports'] = [],
): Promise<E2EApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: ['error'] });
  const document: OpenAPIObject = setupApp(app);
  await app.init();
  return { app, document };
}
