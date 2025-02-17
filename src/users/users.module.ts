import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { AuthModule } from 'src/auth/auth.module';
import { StaticModule } from 'src/static/static.module';
import { Role } from 'src/roles/entities/role.entity';
import { UsersService } from './users.service';
import { UploadModule } from 'src/common/upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    AuthModule,
    StaticModule,
    UploadModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
