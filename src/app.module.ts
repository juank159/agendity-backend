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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRoot({
      ...DataSourceConfig,
      autoLoadEntities: true,
    }),

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
  ],
})
export class AppModule {}
