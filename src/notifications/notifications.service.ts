import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { Notification, ReceiverType } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { Client } from '../clients/entities/client.entity';
import { User } from '../users/entities/user.entity';
import { assertUserInTenant } from '../users/user-access';

/**
 * Las notificaciones no guardan el negocio: pertenecen a un receptor, que es un
 * cliente (`clients.owner_id`) o un usuario (el Owner o un empleado). Todas las
 * operaciones por HTTP comprueban que ese receptor sea del tenant (si no, 404).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Las crea el propio backend (pagos) o un Admin. */
  async create(
    createNotificationDto: CreateNotificationDto,
  ): Promise<Notification> {
    const notification = this.notificationRepository.create(
      createNotificationDto,
    );
    return await this.notificationRepository.save(notification);
  }

  /** Todas las de todos los negocios: solo para Admin. */
  async findAllForAdmin(): Promise<Notification[]> {
    return await this.notificationRepository.find({
      order: { created_at: 'DESC' },
    });
  }

  /** 404 si el receptor no es un cliente o usuario del negocio. */
  private async assertReceiverInTenant(
    receiverId: string,
    receiverType: ReceiverType,
    tenantId: string,
  ): Promise<void> {
    if (!Object.values(ReceiverType).includes(receiverType)) {
      throw new BadRequestException(
        `type debe ser uno de: ${Object.values(ReceiverType).join(', ')}`,
      );
    }
    const notFound = () => new NotFoundException('Receptor no encontrado');
    if (!tenantId || !receiverId || !isUUID(receiverId)) throw notFound();

    const exists =
      receiverType === ReceiverType.CLIENT
        ? await this.clientRepository.exist({
            where: { id: receiverId, ownerId: tenantId },
          })
        : await assertUserInTenant(
            this.userRepository,
            tenantId,
            receiverId,
          ).then(
            () => true,
            (error) => {
              if (error instanceof NotFoundException) return false;
              throw error;
            },
          );
    if (!exists) throw notFound();
  }

  async findByReceiver(
    receiverId: string,
    receiverType: ReceiverType,
    tenantId: string,
  ): Promise<Notification[]> {
    await this.assertReceiverInTenant(receiverId, receiverType, tenantId);
    return await this.notificationRepository.find({
      where: {
        receiver_id: receiverId,
        receiver_type: receiverType,
      },
      order: { created_at: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Notification> {
    const notification = isUUID(id)
      ? await this.notificationRepository.findOne({ where: { id } })
      : null;

    if (!notification) {
      throw new NotFoundException(`Notificación con ID ${id} no encontrada`);
    }

    try {
      await this.assertReceiverInTenant(
        notification.receiver_id,
        notification.receiver_type,
        tenantId,
      );
    } catch {
      // De otro negocio (o huérfana): igual que si no existiera.
      throw new NotFoundException(`Notificación con ID ${id} no encontrada`);
    }

    return notification;
  }

  async markAsRead(id: string, tenantId: string): Promise<Notification> {
    const notification = await this.findOne(id, tenantId);
    notification.read = true;
    return await this.notificationRepository.save(notification);
  }

  async markAllAsRead(
    receiverId: string,
    receiverType: ReceiverType,
    tenantId: string,
  ): Promise<void> {
    await this.assertReceiverInTenant(receiverId, receiverType, tenantId);
    await this.notificationRepository.update(
      { receiver_id: receiverId, receiver_type: receiverType, read: false },
      { read: true },
    );
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const notification = await this.findOne(id, tenantId);
    await this.notificationRepository.remove(notification);
  }

  async getUnreadCount(
    receiverId: string,
    receiverType: ReceiverType,
    tenantId: string,
  ): Promise<number> {
    await this.assertReceiverInTenant(receiverId, receiverType, tenantId);
    return await this.notificationRepository.count({
      where: {
        receiver_id: receiverId,
        receiver_type: receiverType,
        read: false,
      },
    });
  }
}
