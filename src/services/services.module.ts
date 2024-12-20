import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from 'src/categories/categories.module';
import { Service } from './entities/service.entity';
import { User } from 'src/users/entities/user.entity';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, User]),
    CategoriesModule,
    UsersModule
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService]
})
export class ServicesModule {}
