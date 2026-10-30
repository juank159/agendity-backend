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

  // Falla al arrancar si BUSINESS_TIMEZONE (zona por defecto de los negocios
  // nuevos y de respaldo, 6.02) no es una zona IANA válida.
  defaultBusinessTimeZone();
  // Fechas de las respuestas: ISO con el offset de la zona del tenant que pide
  // (6.02, ARQUITECTURA §3). El middleware abre el contexto de la petición y
  // `TenantTimeZoneInterceptor` fija la zona; sin sesión, UTC.
  app.use(requestTimeZoneMiddleware);
  app.getHttpAdapter().getInstance().set('json replacer', businessJsonReplacer);

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

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  return document;
}
