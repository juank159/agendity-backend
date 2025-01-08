import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { FindUserQuery } from 'src/auth/interfaces';
import { isUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { CloudinaryService } from 'src/static/cloudinary.service';
import { JwtRolesGuard } from 'src/auth/jwt/jwt.roles.guard';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @hasRoles(JwtRoles.Owner)
  @UseGuards(JwtAuthGuard, JwtRolesGuard)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':param')
  findOne(@Param('param') param: string) {
    // Transformar el parámetro en un objeto FindUserQuery
    const query: FindUserQuery = this.buildQueryObject(param);
    return this.usersService.findOne(query);
  }

  private buildQueryObject(param: string): FindUserQuery {
    if (isUUID(param)) {
      return { id: param }; // Si es un UUID, buscar por ID
    }
    if (param.includes('@')) {
      return { email: param }; // Si contiene '@', buscar por email
    }
    throw new BadRequestException(
      'Invalid parameter. Must be a valid UUID or email',
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads', // Carpeta temporal para almacenar imágenes
        filename: (req, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = path.extname(file.originalname);
          callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Tipo de Imagen no Aceptada'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }

    const filePath = file.path;

    try {
      const response = await this.cloudinaryService.uploadImage(filePath, {
        folder: 'ecommerce', // Carpeta en Cloudinary
        deleteThenUpload: true, // Elimina el archivo local tras subirlo
      });
      return {
        message: 'Imagen Cargada con Exito',
        url: response.secure_url, // URL segura de la imagen en Cloudinary
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @Patch(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = path.extname(file.originalname);
          callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Tipo de archivo no Aceptado'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async updateUserImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }

    const filePath = file.path;
    const response = await this.cloudinaryService.uploadImage(filePath, {
      folder: 'ecommerce',
      deleteThenUpload: true,
    });

    await this.usersService.updateUserImage(id, response.secure_url);

    return {
      message: 'Imagen Actualizada con Exito',
      url: response.secure_url,
    };
  }
}
