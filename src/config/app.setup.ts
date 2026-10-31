import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  businessJsonReplacer,
  defaultBusinessTimeZone,
} from '../common/utils/date.util';
import { requestTimeZoneMiddleware } from '../common/context/request-time-zone';
import { setupBookingPage } from '../web/booking-page';

/**
 * Configuración HTTP común de la app (prefijo, validación, fechas y Swagger).
 * La usan `main.ts` y los tests e2e, para que prueben la misma app que se publica.
 */
export function setupApp(app: INestApplication): OpenAPIObject {
  app.setGlobalPrefix('api');
  const env = process.env;
  const express = app.getHttpAdapter().getInstance();

  // D.02: detrás de un proxy (hosting), la IP real del cliente para el
  // throttle por IP. Por defecto apagado.
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy !== false) express.set('trust proxy', trustProxy);

  // D.02: CORS solo para los orígenes de `CORS_ORIGINS`. Sin la variable, no
  // hay CORS: la app móvil no lo necesita y la web de reservas es del mismo
  // origen (`/reservar`).
  const origins = corsOrigins(env.CORS_ORIGINS);
  if (origins.length) {
    app.enableCors({ origin: origins, credentials: false });
  }

  // Falla al arrancar si BUSINESS_TIMEZONE (zona por defecto de los negocios
  // nuevos y de respaldo, 6.02) no es una zona IANA válida.
  defaultBusinessTimeZone();
  // Fechas de las respuestas: ISO con el offset de la zona del tenant que pide
  // (6.02, ARQUITECTURA §3). El middleware abre el contexto de la petición y
  // `TenantTimeZoneInterceptor` fija la zona; sin sesión, UTC.
  app.use(requestTimeZoneMiddleware);
  express.set('json replacer', businessJsonReplacer);

  // Página web de reservas (9.02): `/reservar/:slug`, fuera de `/api`.
  setupBookingPage(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Agendity API')
    .setDescription('Agenda de servicios')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  // El documento se genera siempre (lo usan los tests de rutas); la UI y el
  // JSON de Swagger solo se publican fuera de producción o con
  // `SWAGGER_ENABLED=true` (D.02).
  const document = SwaggerModule.createDocument(app, config);
  if (swaggerEnabled(env)) {
    SwaggerModule.setup('api', app, document);
  }
  return document;
}

/** `TRUST_PROXY`: `true`/`false`, número de saltos o lista de subredes de Express. */
export function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  const v = value?.trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** `CORS_ORIGINS`: lista separada por comas (sin espacios ni vacíos). */
export function corsOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Swagger: sí fuera de producción; en producción solo con `SWAGGER_ENABLED=true`. */
export function swaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.SWAGGER_ENABLED === 'true') return true;
  if (env.SWAGGER_ENABLED === 'false') return false;
  return env.NODE_ENV !== 'production';
}
