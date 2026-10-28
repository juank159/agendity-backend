import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmployeesService } from './employees.service';
import { VerificationAttemptsService } from './verification-attempts.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt/jwt.strategy';
import { RolesModule } from 'src/roles/roles.module';
import { EmailModule } from 'src/email/email.module';
import { SubscriptionsModule } from 'src/subscriptions/subscriptions.module';
import { SettingsModule } from 'src/settings/settings.module';

@Module({
  imports: [
    RolesModule,
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    SubscriptionsModule,
    SettingsModule,
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
  providers: [
    AuthService,
    EmployeesService,
    JwtStrategy,
    VerificationAttemptsService,
  ],
  exports: [JwtStrategy, AuthService],
})
export class AuthModule {}
