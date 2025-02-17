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
import { UploadService } from 'src/common/upload/upload.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly uploadService: UploadService,
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

  @Post('image')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    const result = await this.uploadService.uploadImage(file, {
      folder: 'users',
    });
    return {
      message: 'Imagen cargada con éxito',
      url: result.url,
    };
  }

  @Patch(':id/image')
  @UseInterceptors(FileInterceptor('file'))
  async updateUserImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      const result = await this.uploadService.uploadImage(file, {
        folder: 'users',
      });
      const updatedUser = await this.usersService.updateUserImage(
        id,
        result.url,
      );

      return {
        message: 'Imagen actualizada con éxito',
        url: result.url,
        user: updatedUser,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error al actualizar imagen de usuario: ${error.message}`,
      );
    }
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
