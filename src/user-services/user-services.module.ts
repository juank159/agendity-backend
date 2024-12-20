import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserServicesController } from './user-services.controller';
import { UserServicesService } from './user-services.service';
import { UserService } from './entities/user-service.entity';
import { UsersModule } from '../users/users.module';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserService]),
    UsersModule,
    ServicesModule
  ],
  controllers: [UserServicesController],
  providers: [UserServicesService],
})
export class UserServicesModule {}