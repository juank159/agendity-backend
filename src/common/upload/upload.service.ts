import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudinaryService } from 'src/static/cloudinary.service';

// src/common/upload/upload.service.ts
@Injectable()
export class UploadService {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  async uploadImage(
    file: Express.Multer.File,
    options: { folder: string } = { folder: 'default' },
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }

    try {
      const response = await this.cloudinaryService.uploadImage(file.path, {
        folder: options.folder,
        deleteThenUpload: true,
      });

      return {
        message: 'Imagen cargada con éxito',
        url: response.secure_url,
      };
    } catch (error) {
      throw new BadRequestException(`Error al cargar imagen: ${error.message}`);
    }
  }
}
