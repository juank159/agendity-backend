import { Module } from '@nestjs/common';
import { TimeBlocksService } from './time-blocks.service';
import { TimeBlocksController } from './time-blocks.controller';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { UsersModule } from 'src/users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeBlock } from './entities/time-block.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeBlock]),
    UsersModule,
    AppointmentsModule
  ],
  controllers: [TimeBlocksController],
  providers: [TimeBlocksService],
  exports: [TimeBlocksService]
})
export class TimeBlocksModule {}
