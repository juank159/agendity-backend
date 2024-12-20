import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmExceptionFilter } from './common/filters/typeorm-exception.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // app.useGlobalFilters(
  //   new TypeOrmExceptionFilter(),
  //   new AllExceptionsFilter(),
  //   new HttpExceptionFilter(),
  // );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Agendity API')
    .setDescription('Agenda de servicios')
    .setVersion('1.0')
    .addBearerAuth() // Si usas autenticación JWT
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT, process.env.IP_LOCAL || 'localhost');
  console.log(`server on port ${process.env.PORT}`);
}
bootstrap();
