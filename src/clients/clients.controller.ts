import {
  Controller,
  Post,
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
import { Tenant } from 'src/common/decorators/tenant.decorator';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';
import { ImportClientsDto } from './dto/import-clients.dto';
import { PaginationDto } from './dto/pagination.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from 'src/common/upload/upload.service';
import { diskStorage } from 'multer';
import * as path from 'path';
import { hasRoles } from 'src/auth/jwt/has.roles';
import { JwtRoles } from 'src/auth/jwt/jwt.role';

@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly uploadService: UploadService,
  ) {}

  @Post()
  create(@Body() createClientDto: CreateClientDto, @Tenant() tenantId: string) {
    return this.clientsService.create(createClientDto, tenantId);
  }

  @Post('batch')
  async importBatch(
    @Body() importClientsDto: ImportClientsDto,
    @Tenant() tenantId: string,
  ) {
    return this.clientsService.importBatch(importClientsDto.clients, tenantId);
  }

  @Get()
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findAll(@Tenant() tenantId: string, @Query() paginationDto: PaginationDto) {
    return this.clientsService.findAll(tenantId, paginationDto);
  }

  // ✅ ENDPOINT LEGACY PARA RETROCOMPATIBILIDAD
  @Get('all')
  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  findAllLegacy(@Tenant() tenantId: string) {
    return this.clientsService.findAllLegacy(tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Tenant() tenantId: string) {
    return this.clientsService.findOne(id, tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @Tenant() tenantId: string,
  ) {
    return this.clientsService.update(id, updateClientDto, tenantId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Tenant() tenantId: string) {
    return this.clientsService.remove(id, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
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
