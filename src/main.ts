import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './config/app.setup';

/**
 * Host por defecto 0.0.0.0: el backend debe ser alcanzable desde el móvil en la LAN
 * (desarrollo) y desde el proxy del hosting/contenedor (despliegue). Para escuchar
 * solo en la máquina local, definir IP_LOCAL=127.0.0.1.
 */
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  setupApp(app);

  const host = process.env.IP_LOCAL?.trim() || DEFAULT_HOST;
  const port = Number(process.env.PORT) || DEFAULT_PORT;

  await app.listen(port, host);
  new Logger('Bootstrap').log(`Servidor escuchando en http://${host}:${port}`);
}
bootstrap();
