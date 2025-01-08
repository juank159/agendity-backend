import {
  Controller,
  Post,
  UseGuards,
  Get,
  Param,
  Patch,
  Body,
  Delete,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt/jwt.auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { User } from 'src/users/entities/user.entity';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';

@ApiTags('Clientes')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

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
}
