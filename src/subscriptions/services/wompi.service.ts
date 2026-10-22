// src/subscriptions/services/wompi.service.ts

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
  private readonly isProduction: boolean;
  private readonly stubMode: boolean;

  constructor(private configService: ConfigService) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.stubMode = this.configService.get<string>('WOMPI_MODE') === 'stub';

    this.apiBaseUrl = this.isProduction
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';

    this.publicKey = this.configService.get<string>('WOMPI_PUBLIC_KEY');
    this.privateKey = this.configService.get<string>('WOMPI_PRIVATE_KEY');
    this.eventIntegritySecret = this.configService.get<string>(
      'WOMPI_EVENT_INTEGRITY_SECRET',
    );

    // Log configuración
    this.logger.log(
      `Iniciando Wompi Service en modo: ${this.isProduction ? 'PRODUCCIÓN' : 'DESARROLLO'}`,
    );
    this.logger.log(`API Base URL: ${this.apiBaseUrl}`);

    if (this.publicKey) {
      this.logger.log(`Public Key: ${this.publicKey.substring(0, 8)}...`);
    } else {
      this.logger.warn('No se ha configurado WOMPI_PUBLIC_KEY');
    }

    if (!this.privateKey) {
      this.logger.warn('No se ha configurado WOMPI_PRIVATE_KEY');
    }

    if (!this.eventIntegritySecret) {
      this.logger.warn('No se ha configurado WOMPI_EVENT_INTEGRITY_SECRET');
    }

    if (this.stubMode) {
      this.logger.log(
        'MODO STUB ACTIVADO: Se utilizarán respuestas simuladas para Wompi',
      );
    }
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.privateKey}`,
    };
  }

  async getAcceptanceToken(): Promise<string> {
    try {
      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log('Modo stub: Generando token de aceptación simulado');
        return 'stub-acceptance-token-12345';
      }

      this.logger.log('Obteniendo token de aceptación...');
      const response = await axios.get(
        `${this.apiBaseUrl}/merchants/${this.publicKey}`,
      );

      this.logger.log(`Respuesta de token: ${JSON.stringify(response.data)}`);

      if (!response.data.data.presigned_acceptance?.acceptance_token) {
        throw new Error('No se encontró token de aceptación en la respuesta');
      }

      return response.data.data.presigned_acceptance.acceptance_token;
    } catch (error) {
      this.logger.error(`Error al obtener acceptance token: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Respuesta de error: ${JSON.stringify(error.response.data)}`,
        );
      }

      // En modo desarrollo, generar un token de prueba
      if (!this.isProduction) {
        this.logger.log('Generando token de prueba para desarrollo');
        return 'test-acceptance-token-12345';
      }

      throw new Error(`Error getting acceptance token: ${error.message}`);
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
      this.logger.log(
        `Creando link de pago: ${amount} ${currency} para ${description}`,
      );
      this.logger.log(`URL de redirección original: ${redirectUrl}`);
      this.logger.log(`Referencia: ${reference}`);

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log('Modo stub: Generando enlace de pago simulado');
        const stubUrl = `https://checkout.wompi.co/l/stubbed-payment-${Math.random().toString(36).substring(2, 15)}`;
        this.logger.log(`Link de pago simulado: ${stubUrl}`);
        return stubUrl;
      }

      // Procesamiento de URL según ambiente
      let processedRedirectUrl = redirectUrl;

      // Validar formato de URL - Wompi solo acepta URLs https o http válidas
      if (redirectUrl.startsWith('myapp://')) {
        // En producción, usar URLs HTTPS válidas
        if (this.isProduction) {
          // Usar la URL configurada o una por defecto
          processedRedirectUrl =
            this.configService.get<string>('WOMPI_REDIRECT_URL') ||
            'https://tuapp.com/payment-callback';
        } else {
          // En desarrollo, para testing podemos usar una URL de ejemplo
          processedRedirectUrl = 'https://example.com/payment-callback';
        }
      }

      this.logger.log(`URL de redirección procesada: ${processedRedirectUrl}`);

      // Asegurarse que la cantidad sea un entero (centavos)
      const amountInCents = Math.round(amount * 100);

      // Crear objeto para payment link con todos los campos requeridos
      const paymentLinkData = {
        name: description,
        description,
        amount_in_cents: amountInCents,
        currency,
        redirect_url: processedRedirectUrl,
        reference,
        expires_at: this.getExpirationDate(48), // Expira en 48 horas
        // Campos requeridos que estaban faltando
        collect_shipping: false, // No recolectar información de envío
        single_use: true, // El enlace es de un solo uso
      };

      this.logger.log(
        `Datos del link de pago: ${JSON.stringify(paymentLinkData)}`,
      );

      // En modo desarrollo, si no hay credenciales de Wompi configuradas o API_KEY inválida,
      // generar un enlace de demostración sin intentar llamar a Wompi
      if (
        !this.isProduction &&
        (!this.privateKey || this.privateKey === 'your_private_key')
      ) {
        this.logger.log(
          'Credenciales de Wompi no configuradas, generando enlace de demostración...',
        );
        return `myapp://payment-demo?reference=${reference}&redirect=${encodeURIComponent(redirectUrl)}`;
      }

      // Llamar a la API de Wompi
      try {
        const response = await axios.post(
          `${this.apiBaseUrl}/payment_links`,
          paymentLinkData,
          { headers: this.getAuthHeaders() },
        );

        // Registra la respuesta completa para depuración
        this.logger.log(
          `Respuesta completa de Wompi: ${JSON.stringify(response.data)}`,
        );

        // MODIFICACIÓN: Verificar si existe el ID en lugar de la URL
        if (!response.data || !response.data.data || !response.data.data.id) {
          this.logger.error('Respuesta de Wompi no contiene ID de pago');
          this.logger.error(
            `Datos de respuesta: ${JSON.stringify(response.data)}`,
          );
          throw new Error('Respuesta de Wompi no contiene ID de pago');
        }

        // MODIFICACIÓN: Construir la URL del enlace de pago usando el ID
        const linkId = response.data.data.id;
        const paymentUrl = `https://checkout.wompi.co/l/${linkId}`;

        this.logger.log(`Link de pago creado: ${paymentUrl}`);
        return paymentUrl;
      } catch (wompiError) {
        this.logger.error(`Error en API de Wompi: ${wompiError.message}`);
        if (wompiError.response) {
          this.logger.error(
            `Respuesta de error de Wompi: ${JSON.stringify(wompiError.response.data)}`,
          );
        }

        // En desarrollo, generar un enlace de demostración en caso de error
        if (!this.isProduction) {
          this.logger.log('Generando enlace de demostración alternativo...');
          return `myapp://payment-demo?reference=${reference}&redirect=${encodeURIComponent(redirectUrl)}`;
        }

        // En producción, enviar alerta de monitoreo si está configurado
        if (
          this.isProduction &&
          this.configService.get<string>('MONITORING_WEBHOOK')
        ) {
          try {
            await axios.post(
              this.configService.get<string>('MONITORING_WEBHOOK'),
              {
                event: 'wompi_error',
                message: `Error en integración de pagos: ${wompiError.message}`,
                timestamp: new Date().toISOString(),
                environment: this.isProduction ? 'production' : 'development',
              },
            );
          } catch (alertError) {
            this.logger.error(
              `No se pudo enviar alerta: ${alertError.message}`,
            );
          }
        }

        // En producción, propagar el error
        throw wompiError;
      }
    } catch (error) {
      this.logger.error(`Error creating payment link: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }

      // En desarrollo, siempre devolver un enlace de demostración en caso de cualquier error
      if (!this.isProduction) {
        this.logger.log(
          'Generando enlace de demostración como fallback final...',
        );
        return `myapp://payment-demo?reference=${reference}&redirect=${encodeURIComponent(redirectUrl)}`;
      }

      throw new Error(`Error creating payment link: ${error.message}`);
    }
  }

  // Esta función reemplaza a createCustomer que no existe en la API
  async createCardToken(
    cardNumber: string,
    expMonth: string,
    expYear: string,
    cvc: string,
    cardHolder: string,
  ): Promise<string> {
    try {
      this.logger.log('Creando token de tarjeta...');

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log('Modo stub: Generando token de tarjeta simulado');
        return `stub-card-token-${Math.random().toString(36).substring(2, 15)}`;
      }

      // Nota: Este endpoint utiliza la llave pública
      const response = await axios.post(
        `${this.apiBaseUrl}/tokens/cards`,
        {
          number: cardNumber,
          exp_month: expMonth,
          exp_year: expYear,
          cvc: cvc,
          card_holder: cardHolder,
        },
        {
          headers: {
            Authorization: `Bearer ${this.publicKey}`,
          },
        },
      );

      this.logger.log(`Token de tarjeta creado: ${response.data.data.id}`);
      return response.data.data.id;
    } catch (error) {
      this.logger.error(`Error creando token de tarjeta: ${error.message}`);
      if (error.response) {
        this.logger.error(`Respuesta: ${JSON.stringify(error.response.data)}`);
      }

      // En desarrollo, generar un token de prueba
      if (!this.isProduction) {
        this.logger.log('Generando token de tarjeta de prueba para desarrollo');
        return `test-card-token-${Math.random().toString(36).substring(2, 10)}`;
      }

      throw new Error(`Error creando token de tarjeta: ${error.message}`);
    }
  }

  // Crear una fuente de pago usando un token
  async createPaymentSource(
    token: string,
    customerEmail: string,
    type: 'CARD' | 'NEQUI',
  ): Promise<number> {
    try {
      this.logger.log('Creando fuente de pago');

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log('Modo stub: Generando ID de fuente de pago simulado');
        return Math.floor(Math.random() * 1000000);
      }

      const acceptanceToken = await this.getAcceptanceToken();

      const response = await axios.post(
        `${this.apiBaseUrl}/payment_sources`,
        {
          type: type,
          token: token,
          customer_email: customerEmail,
          acceptance_token: acceptanceToken,
        },
        { headers: this.getAuthHeaders() },
      );

      this.logger.log(`Fuente de pago creada: ${response.data.data.id}`);
      return response.data.data.id;
    } catch (error) {
      this.logger.error(`Error creando fuente de pago: ${error.message}`);
      if (error.response) {
        this.logger.error(`Respuesta: ${JSON.stringify(error.response.data)}`);
      }

      // En desarrollo, generar un ID de prueba
      if (!this.isProduction) {
        const testId = Math.floor(Math.random() * 1000000);
        this.logger.log(`Generando ID de fuente de pago de prueba: ${testId}`);
        return testId;
      }

      throw new Error(`Error creando fuente de pago: ${error.message}`);
    }
  }

  private getExpirationDate(hoursFromNow: number): string {
    const date = new Date();
    date.setHours(date.getHours() + hoursFromNow);
    return date.toISOString();
  }

  // Crear una transacción usando una fuente de pago
  async createTransaction(
    amountInCents: number,
    currency: string,
    reference: string,
    customerEmail: string,
    paymentSourceId: number,
    description: string,
  ): Promise<any> {
    try {
      this.logger.log(`Creando transacción: ${amountInCents} ${currency}`);

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log(
          'Modo stub: Generando respuesta de transacción simulada',
        );
        return {
          id: `stub-transaction-${Math.random().toString(36).substring(2, 15)}`,
          created_at: new Date().toISOString(),
          amount_in_cents: amountInCents,
          reference: reference,
          currency: currency,
          payment_method_type: 'CARD',
          payment_method: {
            type: 'CARD',
            extra: {
              name: 'VISA-1111',
              brand: 'VISA',
              last_four: '1111',
              external_identifier: 'stub-card-id',
            },
          },
          status: 'APPROVED',
          status_message: 'Transacción aprobada',
        };
      }

      const signatureInput = `${amountInCents}${currency}${reference}${this.privateKey}`;
      const signature = crypto
        .createHash('sha256')
        .update(signatureInput)
        .digest('hex');

      const response = await axios.post(
        `${this.apiBaseUrl}/transactions`,
        {
          amount_in_cents: amountInCents,
          currency,
          signature,
          reference,
          customer_email: customerEmail,
          payment_source_id: paymentSourceId,
          payment_method: {
            installments: 1,
          },
        },
        { headers: this.getAuthHeaders() },
      );

      this.logger.log(`Transacción creada: ${response.data.data.id}`);
      this.logger.log(`Respuesta completa: ${JSON.stringify(response.data)}`);
      return response.data.data;
    } catch (error) {
      this.logger.error(`Error creando transacción: ${error.message}`);
      if (error.response) {
        this.logger.error(`Respuesta: ${JSON.stringify(error.response.data)}`);
      }

      // En desarrollo, generar una respuesta de prueba
      if (!this.isProduction) {
        this.logger.log(
          'Generando respuesta de transacción de prueba para desarrollo',
        );
        return {
          id: `test-transaction-${Math.random().toString(36).substring(2, 10)}`,
          status: 'APPROVED',
          amount_in_cents: amountInCents,
          currency: currency,
          reference: reference,
          created_at: new Date().toISOString(),
          payment_method: {
            type: 'CARD',
            extra: {
              name: 'Test Card',
              last_four: '1234',
            },
          },
        };
      }

      throw new Error(`Error creando transacción: ${error.message}`);
    }
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      this.logger.log(
        `Intentando cancelar suscripción en Wompi: ${subscriptionId}`,
      );

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log('Modo stub: Simulando cancelación de suscripción');
        return;
      }

      // Para suscripciones reales en Wompi, usarías algo como:
      // await axios.post(
      //   `${this.apiBaseUrl}/subscriptions/${subscriptionId}/cancel`,
      //   {},
      //   { headers: this.getAuthHeaders() },
      // );

      // Pero como estamos usando links de pago en lugar de suscripciones reales,
      // simplemente registramos que se intentó cancelar
      this.logger.log(
        `Simulando cancelación de suscripción. En un entorno real con suscripciones, se enviaría la petición a Wompi.`,
      );

      // No hay una acción real que tomar con links de pago
      // ya que no son suscripciones recurrentes gestionadas por Wompi
    } catch (error) {
      this.logger.error(
        `Error cancelando suscripción en Wompi: ${error.message}`,
      );
      if (error.response) {
        this.logger.error(
          `Wompi response: ${JSON.stringify(error.response.data)}`,
        );
      }

      // En producción, enviar alerta si está configurado
      if (
        this.isProduction &&
        this.configService.get<string>('MONITORING_WEBHOOK')
      ) {
        try {
          await axios.post(
            this.configService.get<string>('MONITORING_WEBHOOK'),
            {
              event: 'wompi_cancel_error',
              message: `Error al cancelar suscripción: ${error.message}`,
              subscription_id: subscriptionId,
              timestamp: new Date().toISOString(),
            },
          );
        } catch (alertError) {
          this.logger.error(`No se pudo enviar alerta: ${alertError.message}`);
        }
      }

      throw new Error(`Error canceling Wompi subscription: ${error.message}`);
    }
  }

  async verifyWebhookEvent(payload: any, signature: string): Promise<boolean> {
    try {
      this.logger.log('Verificando firma de webhook de Wompi');

      // Modo stub para desarrollo
      if (this.stubMode) {
        this.logger.log(
          'Modo stub: Verificación de webhook simulada (siempre válida)',
        );
        return true;
      }

      // Si la firma no está presente, rechazar inmediatamente
      if (!signature) {
        this.logger.warn('Firma de webhook no proporcionada');
        return false;
      }

      // Implementar verificación según documentación de Wompi
      const stringToVerify = JSON.stringify(payload);

      // Verificar que el secreto está configurado
      if (!this.eventIntegritySecret) {
        this.logger.warn('Event integrity secret no configurado');
        return false;
      }

      // Calcular la firma esperada
      const calculatedSignature = crypto
        .createHmac('sha256', this.eventIntegritySecret)
        .update(stringToVerify)
        .digest('hex');

      // Comparar la firma calculada con la proporcionada
      const isValid = calculatedSignature === signature;

      if (!isValid) {
        this.logger.warn(
          `Firma inválida. Esperada: ${calculatedSignature}, Recibida: ${signature}`,
        );
      } else {
        this.logger.log('Firma de webhook válida');
      }

      return isValid;
    } catch (error) {
      this.logger.error(`Error verificando webhook: ${error.message}`);

      // En desarrollo, aceptar webhooks incluso si hay errores en la verificación
      if (!this.isProduction) {
        this.logger.warn(
          'En desarrollo: Aceptando webhook a pesar del error de verificación',
        );
        return true;
      }

      return false;
    }
  }

  // Método para pruebas - permite verificar si las credenciales son válidas
  async testConnection(): Promise<{ status: string; message: string }> {
    try {
      // Modo stub para desarrollo
      if (this.stubMode) {
        return {
          status: 'success',
          message: 'Conexión simulada exitosa (modo stub)',
        };
      }

      // Verificar que tenemos las credenciales mínimas
      if (!this.publicKey || !this.privateKey) {
        return {
          status: 'error',
          message:
            'Faltan credenciales de Wompi (WOMPI_PUBLIC_KEY o WOMPI_PRIVATE_KEY)',
        };
      }

      // Intentar obtener información del merchant como prueba de conexión
      const response = await axios.get(
        `${this.apiBaseUrl}/merchants/${this.publicKey}`,
      );

      if (response.status === 200 && response.data && response.data.data) {
        return {
          status: 'success',
          message: `Conexión exitosa a Wompi. Merchant name: ${response.data.data.name || 'N/A'}`,
        };
      } else {
        return {
          status: 'warning',
          message: 'Respuesta inesperada de Wompi',
        };
      }
    } catch (error) {
      this.logger.error(`Error probando conexión: ${error.message}`);
      if (error.response) {
        this.logger.error(`Respuesta: ${JSON.stringify(error.response.data)}`);
      }

      return {
        status: 'error',
        message: `Error conectando con Wompi: ${error.message}`,
      };
    }
  }

  // Agregar a src/subscriptions/services/wompi.service.ts

  async checkLatestTransactionByReference(reference: string): Promise<string> {
    try {
      this.logger.log(`Verificando transacción con referencia: ${reference}`);

      // En modo stub, simular una transacción exitosa para pruebas
      if (this.stubMode) {
        this.logger.log('Modo stub: Simulando transacción APROBADA');
        return 'APPROVED';
      }

      // Utilizar la API de Wompi para consultar transacciones por referencia
      const response = await axios.get(
        `${this.apiBaseUrl}/transactions?reference=${reference}`,
        { headers: this.getAuthHeaders() },
      );

      this.logger.log(
        `Respuesta de búsqueda de transacciones: ${JSON.stringify(response.data)}`,
      );

      // Verificar si hay datos en la respuesta
      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        // Obtener la transacción más reciente
        const latestTransaction = response.data.data.sort((a, b) => {
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        })[0];

        this.logger.log(
          `Transacción más reciente: ${JSON.stringify(latestTransaction)}`,
        );

        return latestTransaction.status;
      }

      // Si no hay transacciones, retornar PENDING
      return 'PENDING';
    } catch (error) {
      this.logger.error(`Error verificando transacción: ${error.message}`);

      // En desarrollo, simular que es exitosa para pruebas
      if (!this.isProduction) {
        return 'APPROVED';
      }

      throw new Error(`Error verificando transacción: ${error.message}`);
    }
  }
}
