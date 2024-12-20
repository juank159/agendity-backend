import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, ReceiverType } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async create(createNotificationDto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationRepository.create(createNotificationDto);
    return await this.notificationRepository.save(notification);
  }

  async findAll(): Promise<Notification[]> {
    return await this.notificationRepository.find({
      order: { created_at: 'DESC' }
    });
  }

  async findByReceiver(receiverId: string, receiverType: ReceiverType): Promise<Notification[]> {
    return await this.notificationRepository.find({
      where: { 
        receiver_id: receiverId,
        receiver_type: receiverType
      },
      order: { created_at: 'DESC' }
    });
  }

  async findUnreadByReceiver(receiverId: string, receiverType: ReceiverType): Promise<Notification[]> {
    return await this.notificationRepository.find({
      where: { 
        receiver_id: receiverId,
        receiver_type: receiverType,
        read: false
      },
      order: { created_at: 'DESC' }
    });
  }

  async findOne(id: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id }
    });

    if (!notification) {
      throw new NotFoundException(`Notificación con ID ${id} no encontrada`);
    }

    return notification;
  }

  async markAsRead(id: string): Promise<Notification> {
    const notification = await this.findOne(id);
    notification.read = true;
    return await this.notificationRepository.save(notification);
  }

  async markAllAsRead(receiverId: string, receiverType: ReceiverType): Promise<void> {
    await this.notificationRepository.update(
      { receiver_id: receiverId, receiver_type: receiverType, read: false },
      { read: true }
    );
  }

  async update(id: string, updateNotificationDto: UpdateNotificationDto): Promise<Notification> {
    const notification = await this.findOne(id);
    Object.assign(notification, updateNotificationDto);
    return await this.notificationRepository.save(notification);
  }

  async remove(id: string): Promise<void> {
    const notification = await this.findOne(id);
    await this.notificationRepository.remove(notification);
  }

  async getUnreadCount(receiverId: string, receiverType: ReceiverType): Promise<number> {
    return await this.notificationRepository.count({
      where: {
        receiver_id: receiverId,
        receiver_type: receiverType,
        read: false
      }
    });
  }
}