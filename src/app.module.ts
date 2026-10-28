import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { StaticModule } from './static/static.module';
import { RolesModule } from './roles/roles.module';
import { CategoriesModule } from './categories/categories.module';
import { ServicesModule } from './services/services.module';
import { UserServicesModule } from './user-services/user-services.module';
import { ClientsModule } from './clients/clients.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { SchedulesModule } from './schedules/schedules.module';
import { ReviewsModule } from './reviews/reviews.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { TimeBlocksModule } from './time-blocks/time-blocks.module';
import { DataSourceConfig } from './config/data.postgres.source';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SettingsModule } from './settings/settings.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt/jwt.auth.guard';
import { JwtRolesGuard } from './auth/jwt/jwt.roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      ...DataSourceConfig,
      autoLoadEntities: true,
    }),

    EventEmitterModule.forRoot(),

    // Almacén en memoria para @RateLimit (solo rutas de /auth). Ver common/decorators/rate-limit.decorator.ts
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),

    UsersModule,

    AuthModule,

    StaticModule,

    RolesModule,

    CategoriesModule,

    ServicesModule,

    UserServicesModule,

    ClientsModule,

    AppointmentsModule,

    SchedulesModule,

    ReviewsModule,

    NotificationsModule,

    PaymentsModule,

    TimeBlocksModule,

    WhatsappModule,

    SubscriptionsModule,

    SettingsModule,
  ],
  providers: [
    // El orden importa: primero se autentica (JWT) y después se comprueban los roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: JwtRolesGuard },
    // Aplica @Exclude() de las entidades (p. ej. secretos de User) a toda respuesta.
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    // Formato único de errores (ARQUITECTURA.md §3).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
