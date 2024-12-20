import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from 'src/users/users.module';
import { Schedule } from './entities/schedule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Schedule]),
    UsersModule,
  ],
  controllers: [SchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService]
})
export class SchedulesModule {}
