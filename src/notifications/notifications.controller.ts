import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { hasRoles } from '../auth/jwt/has.roles';
import { JwtRoles } from '../auth/jwt/jwt.role';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Notification, ReceiverType } from './entities/notification.entity';
import { Tenant } from '../common/decorators/tenant.decorator';

@ApiTags('Notificaciones')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Las notificaciones las crea el propio backend; por HTTP solo Admin.
  @hasRoles(JwtRoles.Admin)
  @Post()
  @ApiOperation({ summary: 'Crear una nueva notificación' })
  @ApiResponse({ status: 201, description: 'Notificación creada exitosamente', type: Notification })
  create(@Body() createNotificationDto: CreateNotificationDto) {
    return this.notificationsService.create(createNotificationDto);
  }

  // Vista global de todos los negocios: solo Admin. Para un negocio: GET receiver/:receiverId.
  @hasRoles(JwtRoles.Admin)
  @Get()
  @ApiOperation({ summary: 'Obtener todas las notificaciones' })
  @ApiResponse({ status: 200, description: 'Lista de notificaciones', type: [Notification] })
  findAll() {
    return this.notificationsService.findAllForAdmin();
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get('receiver/:receiverId')
  @ApiOperation({ summary: 'Obtener notificaciones de un receptor' })
  @ApiQuery({ name: 'type', enum: ReceiverType })
  @ApiResponse({ status: 200, description: 'Notificaciones del receptor', type: [Notification] })
  findByReceiver(
    @Param('receiverId') receiverId: string,
    @Query('type') receiverType: ReceiverType,
    @Tenant() tenantId: string,
  ) {
    return this.notificationsService.findByReceiver(receiverId, receiverType, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
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
    @Query('type') receiverType: ReceiverType,
    @Tenant() tenantId: string,
  ) {
    return this.notificationsService.getUnreadCount(receiverId, receiverType, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Patch('read/:id')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  @ApiResponse({ status: 200, description: 'Notificación marcada como leída', type: Notification })
  markAsRead(@Param('id') id: string, @Tenant() tenantId: string) {
    return this.notificationsService.markAsRead(id, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Patch('read-all/:receiverId')
  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  @ApiQuery({ name: 'type', enum: ReceiverType })
  @ApiResponse({ status: 200, description: 'Todas las notificaciones marcadas como leídas' })
  markAllAsRead(
    @Param('receiverId') receiverId: string,
    @Query('type') receiverType: ReceiverType,
    @Tenant() tenantId: string,
  ) {
    return this.notificationsService.markAllAsRead(receiverId, receiverType, tenantId);
  }

  @hasRoles(JwtRoles.Owner, JwtRoles.Employee)
  @Get(':id')
  @ApiOperation({ summary: 'Obtener una notificación por ID' })
  @ApiResponse({ status: 200, description: 'Notificación encontrada', type: Notification })
  findOne(@Param('id') id: string, @Tenant() tenantId: string) {
    return this.notificationsService.findOne(id, tenantId);
  }

  @hasRoles(JwtRoles.Owner)
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una notificación' })
  @ApiResponse({ status: 200, description: 'Notificación eliminada' })
  remove(@Param('id') id: string, @Tenant() tenantId: string) {
    return this.notificationsService.remove(id, tenantId);
  }
}