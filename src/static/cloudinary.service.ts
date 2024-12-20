import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiOptions, UploadApiResponse } from 'cloudinary';

import * as fs from 'node:fs/promises';

@Injectable()
export class CloudinaryService {
  private logger: Logger = new Logger(CloudinaryService.name);
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  /**
   * Subir una imagen a Cloudinary
   * @param filePath - Ruta del archivo local o URL del archivo
   * @param publicId - ID público opcional para la imagen
   * @param folder - Carpeta opcional para la imagen
   * @param deleteThenUpload - Eliminar el archivo local después de subirlo
   * @returns Respuesta de Cloudinary
   */
  async uploadImage(
    filePath: string,
    options: { publicId?: string; folder?: string, deleteThenUpload?: boolean } = {},
  ): Promise<UploadApiResponse> {
    const exist = await this.existLocalFile(filePath);
    if (!exist) {
      throw new BadRequestException('File not found to upload image');
    }
    try {
      // Configurar opciones para Cloudinary
      const uploadOptions: UploadApiOptions = {
        public_id: options.publicId || undefined,
        folder: options.folder || undefined, // Carpeta específica
      };

      // Subir imagen a Cloudinary
      const image = await cloudinary.uploader.upload(filePath, uploadOptions);
      // delete file
      if (options.deleteThenUpload) {
        fs.unlink(filePath);
      }
      return image;
    } catch (error) {
      this.logger.error('Error subiendo imagen a Cloudinary:', error);
      throw new InternalServerErrorException('Error subiendo imagen a Cloudinary');
    }
  }

  /**
   * Actualizar una imagen en Cloudinary
   * @param publicId - ID público de la imagen existente
   * @param newFilePath - Nueva ruta del archivo para actualizar
   * @param deleteThenUpload - Eliminar el archivo local después de subirlo
   * @returns Respuesta de Cloudinary
   */
  async updateImage(
    publicId: string,
    newFilePath: string,
    deleteThenUpload?: boolean
  ): Promise<UploadApiResponse> {
    const exist = await this.existLocalFile(newFilePath);
    if (!exist) {
      throw new BadRequestException('File not found to upload image');
    }
    try {

      // Sobrescribe la imagen existente
      const image = await cloudinary.uploader.upload(newFilePath, {
        public_id: publicId,
        overwrite: true,
      });
      // delete file
      if (deleteThenUpload) {
        fs.unlink(newFilePath);
      }
      return image;
    } catch (error) {
      this.logger.error('Error actualizando imagen en Cloudinary:', error);
      throw new InternalServerErrorException('Error actualizando imagen en Cloudinary');
    }
  }

  /**
   * Eliminar una imagen de Cloudinary
   * @param publicId - ID público de la imagen
   * @returns Respuesta de Cloudinary
   */
  async deleteImage(publicId: string): Promise<{ result: string }> {
    try {
      return await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      this.logger.error('Error eliminando imagen en Cloudinary:', error);
      throw new InternalServerErrorException('Error eliminando imagen en Cloudinary');
    }
  }
  async existLocalFile(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }
}