import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadService } from './upload.service';
import { existsSync, mkdirSync } from 'fs';
import * as path from 'path';

@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);
  private readonly UPLOAD_DIR = './uploads';
  private readonly ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
  ];
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(private readonly uploadService: UploadService) {
    this.ensureUploadDirectoryExists();
  }

  private ensureUploadDirectoryExists() {
    if (!existsSync(this.UPLOAD_DIR)) {
      try {
        mkdirSync(this.UPLOAD_DIR, { recursive: true });
        this.logger.log(`Directorio de uploads creado: ${this.UPLOAD_DIR}`);
      } catch (error) {
        this.logger.error(
          `Error al crear directorio de uploads: ${error.message}`,
        );
        throw new Error('No se pudo crear el directorio de uploads');
      }
    }
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          try {
            if (!file || !file.originalname) {
              throw new Error('Archivo inválido');
            }

            const timestamp = Date.now();
            const randomString = Array(8)
              .fill(null)
              .map(() => Math.round(Math.random() * 16).toString(16))
              .join('');

            const ext = path.extname(file.originalname) || '.jpg';
            const newFilename = `${timestamp}-${randomString}${ext}`;

            cb(null, newFilename);
          } catch (error) {
            cb(error, null);
          }
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        const maxSize = 5 * 1024 * 1024; // 5MB

        if (!allowedTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Tipo de archivo no permitido. Se permiten: ${allowedTypes.join(', ')}`,
            ),
            false,
          );
        }
        cb(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder: string = 'default',
  ) {
    try {
      this.logger.log('Iniciando proceso de carga de imagen', {
        originalname: file?.originalname,
        mimetype: file?.mimetype,
        size: file?.size,
        folder,
      });

      if (!file) {
        throw new BadRequestException('No se recibió ningún archivo');
      }

      const result = await this.uploadService.uploadImage(file, { folder });

      this.logger.log('Imagen cargada exitosamente', {
        url: result.url,
        folder,
      });

      return {
        url: result.url,
        message: 'Imagen cargada exitosamente',
      };
    } catch (error) {
      this.logger.error(`Error en uploadImage: ${error.message}`, error.stack);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Error al procesar la imagen. Por favor, intente nuevamente.',
      );
    }
  }
}
