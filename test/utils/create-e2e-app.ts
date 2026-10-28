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

/**
 * Timeout de los tests que recorren MUCHAS rutas en un solo `it` (2.27): el
 * barrido de las ~130 rutas de `auth-guard` (dos veces) y las 14 lecturas de
 * `user-secrets`. Su coste crece con el número de rutas, no con un fallo: con
 * la máquina cargada llegaron a 5,3 s, por encima de los 5 s de jest. El resto
 * de tests sigue con los 5 s por defecto.
 */
export const E2E_ROUTE_SCAN_TIMEOUT_MS = 30_000;

/**
 * Timeout de los tests de carreras que repiten la carrera en varias rondas
 * (6.03). "2 anticipos simultáneos" hace 3 rondas de: crear una cita + 4 pagos
 * a la vez que el lock de la cita SERIALIZA (cada uno espera al anterior) +
 * consultas de comprobación: ~20 transacciones en fila en un solo `it`. En
 * reposo tarda ~1 s; con la máquina cargada (load ~9, 2026-10-28) pasó de los
 * 5 s de jest. El coste crece con las rondas, no con un fallo: si la regla se
 * rompe, falla por las aserciones, no por tiempo.
 */
export const E2E_RACE_TIMEOUT_MS = 30_000;

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
