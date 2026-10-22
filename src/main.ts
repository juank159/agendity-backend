import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './config/app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  setupApp(app);

  await app.listen(process.env.PORT, process.env.IP_LOCAL || 'localhost');
  console.log(`server on port ${process.env.PORT}`);
}
bootstrap();
