import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);
  private readonly apiBaseUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly eventIntegritySecret: string;

  constructor(private configService: ConfigService) {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.apiBaseUrl = isProduction
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';
    this.publicKey = this.configService.get<string>('WOMPI_PUBLIC_KEY');
    this.privateKey = this.configService.get<string>('WOMPI_PRIVATE_KEY');
    this.eventIntegritySecret = this.configService.get<string>(
      'WOMPI_EVENT_INTEGRITY_SECRET',
    );
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.privateKey}`,
    };
  }

  async createCustomer(
    email: string,
    name: string,
    phone: string,
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/customers`,
        {
          email,
          full_name: name,
          phone_number: phone,
        },
        { headers: this.getAuthHeaders() },
      );

      return response.data.data.id;
    } catch (error) {
      this.logger.error(`Error creating Wompi customer: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Error creating Wompi customer: ${error.message}`);
    }
  }

  async createSubscription(
    customerId: string,
    planId: string,
    cardTokenId: string,
    amount: number,
    currency: string = 'COP',
  ): Promise<{ id: string; status: string }> {
    try {
      // 1. Registrar un método de pago (tarjeta)
      const paymentMethod = await axios.post(
        `${this.apiBaseUrl}/payment_sources`,
        {
          type: 'CARD',
          token: cardTokenId,
          customer_email: customerId, // En Wompi a veces se usa el email en lugar del ID
          acceptance_token: await this.getAcceptanceToken(),
        },
        { headers: this.getAuthHeaders() },
      );

      const paymentSourceId = paymentMethod.data.data.id;

      // 2. Crear una suscripción periódica
      // Nota: La implementación específica dependerá de cómo Wompi maneje las suscripciones recurrentes
      const subscription = await axios.post(
        `${this.apiBaseUrl}/subscriptions`,
        {
          customer_id: customerId,
          payment_source_id: paymentSourceId,
          plan_id: planId,
          amount_in_cents: amount * 100, // Convertir a centavos
          currency,
        },
        { headers: this.getAuthHeaders() },
      );

      return {
        id: subscription.data.data.id,
        status: subscription.data.data.status,
      };
    } catch (error) {
      this.logger.error(`Error creating Wompi subscription: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Error creating Wompi subscription: ${error.message}`);
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/subscriptions/${subscriptionId}/cancel`,
        {},
        { headers: this.getAuthHeaders() },
      );
    } catch (error) {
      this.logger.error(`Error canceling Wompi subscription: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Error canceling Wompi subscription: ${error.message}`);
    }
  }

  async getAcceptanceToken(): Promise<string> {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/merchants/${this.publicKey}`,
      );
      return response.data.data.presigned_acceptance.acceptance_token;
    } catch (error) {
      this.logger.error(`Error getting acceptance token: ${error.message}`);
      throw new Error(`Error getting acceptance token: ${error.message}`);
    }
  }

  async verifyWebhookEvent(payload: any, signature: string): Promise<boolean> {
    try {
      // Implementar verificación según documentación de Wompi
      const stringToVerify = JSON.stringify(payload);
      const calculatedSignature = crypto
        .createHmac('sha256', this.eventIntegritySecret)
        .update(stringToVerify)
        .digest('hex');

      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Error verifying webhook: ${error.message}`);
      return false;
    }
  }

  async createPaymentLink(
    amount: number,
    description: string,
    redirectUrl: string,
    reference: string,
    currency: string = 'COP',
  ): Promise<string> {
    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/payment_links`,
        {
          name: description,
          description,
          amount_in_cents: amount * 100, // Convertir a centavos
          currency,
          redirect_url: redirectUrl,
          reference,
          expires_at: this.getExpirationDate(48), // Expira en 48 horas
        },
        { headers: this.getAuthHeaders() },
      );

      return response.data.data.url;
    } catch (error) {
      this.logger.error(`Error creating payment link: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new Error(`Error creating payment link: ${error.message}`);
    }
  }

  private getExpirationDate(hoursFromNow: number): string {
    const date = new Date();
    date.setHours(date.getHours() + hoursFromNow);
    return date.toISOString();
  }
}
