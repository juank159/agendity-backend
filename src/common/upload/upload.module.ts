import { Module } from '@nestjs/common';
import { CloudinaryService } from 'src/static/cloudinary.service';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule, // Para configuración de cloudinary
  ],
  controllers: [UploadController],
  providers: [UploadService, CloudinaryService],
  exports: [UploadService], // Exportamos el servicio para que otros módulos lo usen
})
export class UploadModule {}
