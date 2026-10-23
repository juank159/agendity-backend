import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import {
  businessJsonReplacer,
  businessTimeZone,
} from '../common/utils/date.util';

/**
 * Configuración HTTP común de la app (prefijo, validación, fechas y Swagger).
 * La usan `main.ts` y los tests e2e, para que prueben la misma app que se publica.
 */
export function setupApp(app: INestApplication): OpenAPIObject {
  app.setGlobalPrefix('api');

  // Falla al arrancar si BUSINESS_TIMEZONE no es una zona IANA válida.
  businessTimeZone();
  // Fechas de las respuestas: ISO con el offset del negocio (ARQUITECTURA §3).
  app.getHttpAdapter().getInstance().set('json replacer', businessJsonReplacer);

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
