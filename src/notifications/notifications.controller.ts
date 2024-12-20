import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { Notification, ReceiverType } from './entities/notification.entity';

@ApiTags('Notificaciones')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva notificación' })
  @ApiResponse({ status: 201, description: 'Notificación creada exitosamente', type: Notification })
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las notificaciones' })
  @ApiResponse({ status: 200, description: 'Lista de notificaciones', type: [Notification] })
  findAll() {
    return this.notificationsService.findAll();
  }

  @Get('receiver/:receiverId')
  @ApiOperation({ summary: 'Obtener notificaciones de un receptor' })
  @ApiQuery({ name: 'type', enum: ReceiverType })
  @ApiResponse({ status: 200, description: 'Notificaciones del receptor', type: [Notification] })
  findByReceiver(
    @Param('receiverId') receiverId: string,
    @Query('type') receiverType: ReceiverType
  ) {
    return this.notificationsService.findByReceiver(receiverId, receiverType);
  }

  @Get('unread/count/:receiverId')
  @ApiOperation({ summary: 'Obtener cantidad de notificaciones no leídas' })
  @ApiQuery({ name: 'type', enum: ReceiverType })
  @ApiResponse({ 
    status: 200, 
    description: 'Cantidad de notificaciones no leídas',
    schema: { type: 'number' }
  })
  getUnreadCount(
    @Param('receiverId') receiverId: string,
    @Query('type') receiverType: ReceiverType
  ) {
    return this.notificationsService.getUnreadCount(receiverId, receiverType);
  }

  @Patch('read/:id')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  @ApiResponse({ status: 200, description: 'Notificación marcada como leída', type: Notification })
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Patch('read-all/:receiverId')
  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  @ApiQuery({ name: 'type', enum: ReceiverType })
  @ApiResponse({ status: 200, description: 'Todas las notificaciones marcadas como leídas' })
  markAllAsRead(
    @Param('receiverId') receiverId: string,
    @Query('type') receiverType: ReceiverType
  ) {
    return this.notificationsService.markAllAsRead(receiverId, receiverType);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una notificación por ID' })
  @ApiResponse({ status: 200, description: 'Notificación encontrada', type: Notification })
  findOne(@Param('id') id: string) {
    return this.notificationsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una notificación' })
  @ApiResponse({ status: 200, description: 'Notificación eliminada' })
  remove(@Param('id') id: string) {
    return this.notificationsService.remove(id);
  }
}