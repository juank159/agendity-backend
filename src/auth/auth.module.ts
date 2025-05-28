// import { forwardRef, Module } from '@nestjs/common';
// import { AuthService } from './auth.service';
// import { AuthController } from './auth.controller';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { User } from 'src/users/entities/user.entity';

// import { JwtModule } from '@nestjs/jwt';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { JwtStrategy } from './jwt/jwt.strategy';
// import { RolesModule } from 'src/roles/roles.module';
// import { EmailModule } from 'src/email/email.module';
// import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';

// @Module({
//   imports: [
//     RolesModule,
//     ConfigModule,
//     TypeOrmModule.forFeature([User]),
//     forwardRef(() => SubscriptionsModule),
//     JwtModule.registerAsync({
//       imports: [ConfigModule],
//       inject: [ConfigService],
//       useFactory: async (configService: ConfigService) => ({
//         global: true,
//         secret: configService.get<string>('SECRET_KEY_JWT'),
//         signOptions: { expiresIn: '1d' },
//       }),
//     }),
//     EmailModule,
//   ],
//   controllers: [AuthController],
//   providers: [AuthService, JwtStrategy],
//   exports: [JwtStrategy],
// })
// export class AuthModule {}

import { forwardRef, Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt/jwt.strategy';
import { RolesModule } from 'src/roles/roles.module';
import { EmailModule } from 'src/email/email.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { UserServicesModule } from 'src/user-services/user-services.module';
import { SchedulesModule } from 'src/schedules/schedules.module';

@Module({
  imports: [
    RolesModule,
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => UserServicesModule), // Añadir referencia a módulo de servicios de usuario
    forwardRef(() => SchedulesModule), // Añadir referencia a módulo de horarios
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        global: true,
        secret: configService.get<string>('SECRET_KEY_JWT'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtStrategy, AuthService], // Exportar AuthService para que pueda ser usado por otros módulos
})
export class AuthModule {}
