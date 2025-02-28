// src/whatsapp/whatsapp.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WhatsappConfiguration } from './entities/whatsapp-config.entity';
import axios from 'axios';
import { CreateWhatsappConfigDto } from './dto/create-whatsapp-config.dto';
import { UpdateWhatsappConfigDto } from './dto/update-whatsapp-config.dto';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectRepository(WhatsappConfiguration)
    private whatsappConfigRepository: Repository<WhatsappConfiguration>,
  ) {}

  // Crear nueva configuración de WhatsApp
  async create(
    createWhatsappConfigDto: CreateWhatsappConfigDto,
    ownerId: string,
  ): Promise<WhatsappConfiguration> {
    try {
      // Verificar si ya existe una configuración para este owner
      const existingConfig = await this.whatsappConfigRepository.findOne({
        where: { ownerId },
      });

      if (existingConfig) {
        // Actualizar la configuración existente
        const updated = await this.update(
          existingConfig.id,
          createWhatsappConfigDto,
          ownerId,
        );
        return updated;
      }

      // Crear nueva configuración
      const newConfig = this.whatsappConfigRepository.create({
        ...createWhatsappConfigDto,
        ownerId,
      });

      return await this.whatsappConfigRepository.save(newConfig);
    } catch (error) {
      this.logger.error(
        `Error creating WhatsApp configuration: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Encontrar configuración por ownerId
  async findByOwnerId(ownerId: string): Promise<WhatsappConfiguration> {
    const config = await this.whatsappConfigRepository.findOne({
      where: { ownerId },
    });

    if (!config) {
      throw new NotFoundException(
        `WhatsApp configuration not found for owner ${ownerId}`,
      );
    }

    return config;
  }

  // Actualizar configuración
  async update(
    id: string,
    updateWhatsappConfigDto: UpdateWhatsappConfigDto,
    ownerId: string,
  ): Promise<WhatsappConfiguration> {
    try {
      const config = await this.whatsappConfigRepository.findOne({
        where: { id, ownerId },
      });

      if (!config) {
        throw new NotFoundException(
          `WhatsApp configuration with ID ${id} not found`,
        );
      }

      Object.assign(config, updateWhatsappConfigDto);
      return await this.whatsappConfigRepository.save(config);
    } catch (error) {
      this.logger.error(
        `Error updating WhatsApp configuration: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // Enviar mensaje de WhatsApp
  async sendWhatsAppMessage(
    ownerId: string,
    phoneNumber: string,
    message: string,
  ): Promise<any> {
    try {
      // Obtener configuración del owner
      const config = await this.whatsappConfigRepository.findOne({
        where: { ownerId, isEnabled: true },
      });

      if (!config) {
        this.logger.warn(
          `Cannot send WhatsApp message: Missing or disabled configuration for owner ${ownerId}`,
        );
        return {
          success: false,
          message: 'WhatsApp not configured or disabled for this owner',
        };
      }

      // Formatear el mensaje para URL
      const encodedMessage = encodeURIComponent(message);

      // Formatear el número del cliente (eliminar '+' si existe)
      const formattedPhone = phoneNumber.startsWith('+')
        ? phoneNumber.substring(1)
        : phoneNumber;

      // Construir URL de CallMeBot
      const apiUrl = `https://api.callmebot.com/whatsapp.php?phone=${config.phoneNumber}&text=${encodedMessage}&apikey=${config.apiKey}`;

      // Enviar solicitud a CallMeBot
      const response = await axios.get(apiUrl);

      this.logger.log(
        `WhatsApp message to ${formattedPhone} response:`,
        response.data,
      );

      if (
        response.data &&
        (response.data.includes('Message queued') ||
          response.data.includes('Message sent'))
      ) {
        return { success: true, message: 'Message sent successfully' };
      } else {
        return {
          success: false,
          message: 'Failed to send message',
          details: response.data,
        };
      }
    } catch (error) {
      this.logger.error(
        `Error sending WhatsApp message: ${error.message}`,
        error.response?.data || error,
      );

      return {
        success: false,
        error: error.message,
        details: error.response?.data || 'Unknown error',
      };
    }
  }

  // Enviar mensaje de prueba
  async sendTestMessage(ownerId: string): Promise<any> {
    try {
      const config = await this.findByOwnerId(ownerId);
      const testMessage = `🔔 Este es un mensaje de prueba enviado desde tu aplicación de agendamiento. ✅`;

      return this.sendWhatsAppMessage(ownerId, config.phoneNumber, testMessage);
    } catch (error) {
      return {
        success: false,
        message: 'Failed to send test message',
        error: error.message,
      };
    }
  }
}
