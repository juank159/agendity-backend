import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { FindUserQuery, JwtPayload } from 'src/auth/interfaces';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { isUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @Get()
  findAll(@GetUser() actor: JwtPayload) {
    return this.usersService.findAll(actor);
  }

  @hasRoles(JwtRoles.Owner)
  @Get(':param')
  findOne(@Param('param') param: string, @GetUser() actor: JwtPayload) {
    const query: FindUserQuery = this.buildQueryObject(param);
    return this.usersService.findOneForActor(actor, query);
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

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUser() actor: JwtPayload,
  ) {
    return this.usersService.update(actor, id, updateUserDto);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
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

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Patch(':id/image')
  @UseInterceptors(FileInterceptor('file'))
  async updateUserImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
    @GetUser() actor: JwtPayload,
  ) {
    // Comprobar el acceso ANTES de subir la imagen (404 si no es suyo).
    await this.usersService.findOneForActor(actor, { id });
    try {
      const result = await this.uploadService.uploadImage(file, {
        folder: 'users',
      });
      const updatedUser = await this.usersService.updateUserImage(
        actor,
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

  // Sin DELETE: el borrado de empleados es soft-delete y vive en
  // DELETE /auth/employee/:id (tarea 1.21). Borrar físicamente rompía las FK.
}
