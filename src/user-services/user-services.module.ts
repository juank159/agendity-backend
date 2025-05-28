import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserServicesController } from './user-services.controller';
import { UserServicesService } from './user-services.service';
import { UserService } from './entities/user-service.entity';
import { UsersModule } from '../users/users.module';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserService]),
    forwardRef(() => UsersModule), // Usar forwardRef aquí
    ServicesModule,
  ],
  controllers: [UserServicesController],
  providers: [UserServicesService],
  exports: [UserServicesService], // Asegúrate de exportar el servicio
})
export class UserServicesModule {}
