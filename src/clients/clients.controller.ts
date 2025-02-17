import {
  Controller,
  Post,
  UseGuards,
  Get,
  Param,
  Patch,
  Body,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { User } from 'src/users/entities/user.entity';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';
import { ImportClientsDto } from './dto/import-clients.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from 'src/common/upload/upload.service';
import { diskStorage } from 'multer';
import * as path from 'path';

@ApiTags('Clientes')
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly uploadService: UploadService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Crear un nuevo cliente' })
  @ApiResponse({
    status: 201,
    description: 'Cliente creado exitosamente',
    type: Client,
  })
  create(@Body() createClientDto: CreateClientDto, @GetUser() user: User) {
    return this.clientsService.create(createClientDto, user.id);
  }

  @Post('batch')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Importar múltiples clientes' })
  @ApiResponse({
    status: 201,
    description: 'Clientes importados exitosamente',
    type: [Client],
  })
  async importBatch(
    @Body() importClientsDto: ImportClientsDto,
    @GetUser() user: User,
  ) {
    return this.clientsService.importBatch(importClientsDto.clients, user.id);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener todos los clientes' })
  findAll(@GetUser() user: User) {
    return this.clientsService.findAll(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener un cliente por ID' })
  findOne(@Param('id') id: string, @GetUser() user: User) {
    return this.clientsService.findOne(id, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Actualizar un cliente' })
  update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @GetUser() user: User,
  ) {
    return this.clientsService.update(id, updateClientDto, user.id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Eliminar un cliente' })
  remove(@Param('id') id: string, @GetUser() user: User) {
    return this.clientsService.remove(id, user.id);
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, callback) => {
          if (!file) {
            return callback(new Error('No file'), '');
          }
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const ext = file.originalname
            ? path.extname(file.originalname)
            : '.jpg';
          callback(null, `file-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.startsWith('image/')) {
          return callback(
            new BadRequestException('Solo se permiten imágenes'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('folder') folder: string = 'default',
  ) {
    try {
      if (!file) {
        throw new BadRequestException('No se proporcionó ningún archivo');
      }

      console.log('Archivo recibido:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
      });

      const result = await this.uploadService.uploadImage(file, { folder });
      return result;
    } catch (error) {
      console.error('Error al subir imagen:', error);
      throw new BadRequestException(error.message);
    }
  }
}
