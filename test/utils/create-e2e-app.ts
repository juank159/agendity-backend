/**
 * Arranca la app real (AppModule + setupApp de main.ts) para los tests e2e.
 *
 * Usa el Postgres de desarrollo sin tocar el esquema: `synchronize` y
 * `migrationsRun` se fuerzan a false (aunque el `.env` traiga
 * `DB_MIGRATIONS_RUN=true`) y no se cargan migraciones. Los tests solo deben hacer lecturas
 * o peticiones que los guards corten antes del handler.
 *
 * HTTP (tarea 1.23): la app escucha UNA vez en 127.0.0.1 y todas las peticiones
 * van por un único socket keep-alive. No usar `request(app.getHttpServer())`:
 * supertest abre y cierra un servidor efímero por petición y, con cientos de
 * peticiones seguidas, da `socket hang up`/`ETIMEDOUT` intermitentes (carrera al
 * cerrar el servidor y agotamiento de puertos en TIME_WAIT).
 */
import { Agent } from 'http';
import { INestApplication, ModuleMetadata } from '@nestjs/common';
import * as request from 'supertest';
import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSourceConfig } from '../../src/config/data.postgres.source';

// Debe ir antes de cargar AppModule: AppModule copia esta config al evaluarse.
Object.assign(DataSourceConfig, {
  synchronize: false,
  migrationsRun: false,
  migrations: [],
  entities: [],
  logging: false,
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupApp } = require('../../src/config/app.setup');

/**
 * Timeout de los `beforeAll` que arrancan la app (2.23). En reposo tarda
 * ~150 ms, pero con la máquina cargada (al salir de hibernar, otros procesos)
 * se midieron más de 5 s: el timeout por defecto de jest (5 s, pensado para
 * cada test) hacía fallar todo el spec de forma intermitente.
 */
export const E2E_BOOT_TIMEOUT_MS = 60_000;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type E2EMethod = (typeof HTTP_METHODS)[number];
export type E2EHttp = Record<E2EMethod, (path: string) => request.Test>;

export interface E2EApp {
  app: INestApplication;
  document: OpenAPIObject;
  /** Cliente HTTP contra la app ya escuchando: `http.get('/api/...')`. */
  http: E2EHttp;
  /** Cierra el socket keep-alive y la app. Llamar en `afterAll`. */
  close: () => Promise<void>;
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
  await app.listen(0, '127.0.0.1');

  const server = app.getHttpServer();
  // El cliente cierra los sockets ociosos (30 s) antes que el servidor (60 s):
  // así nunca reutiliza un socket que el servidor está cerrando.
  server.keepAliveTimeout = 60_000;
  const agent = new Agent({ keepAlive: true, maxSockets: 1, timeout: 30_000 });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const http = Object.fromEntries(
    HTTP_METHODS.map((method) => [
      method,
      (path: string) => request(baseUrl)[method](path).agent(agent),
    ]),
  ) as E2EHttp;

  const close = async () => {
    agent.destroy();
    await app.close();
  };

  return { app, document, http, close };
}
