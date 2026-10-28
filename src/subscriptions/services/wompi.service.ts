// src/subscriptions/services/wompi.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import {
  WompiEvent,
  WompiTransaction,
  hasValidWompiChecksum,
  parseWompiTransaction,
} from '../wompi-event';

@Injectable()
export class WompiService {
  private readonly logger = new Logger(WompiService.name);
  private readonly apiBaseUrl: string;
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly eventIntegritySecret: string;
  private readonly isProduction: boolean;
  /** `NODE_ENV=development` explícito. Cualquier otro valor (incluido vacío) = comportamiento real. */
  private readonly isDevelopment: boolean;
  private readonly stubMode: boolean;

  constructor(private configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    this.isProduction = nodeEnv === 'production';
    this.isDevelopment = nodeEnv === 'development';
    const wantsStub = this.configService.get<string>('WOMPI_MODE') === 'stub';
    this.stubMode = this.isDevelopment && wantsStub;

    this.apiBaseUrl = this.isProduction
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';

    this.publicKey = this.configService.get<string>('WOMPI_PUBLIC_KEY');
    this.privateKey = this.configService.get<string>('WOMPI_PRIVATE_KEY');
    this.eventIntegritySecret = this.configService.get<string>(
      'WOMPI_EVENT_INTEGRITY_SECRET',
    );

    // En producción la app no arranca sin las credenciales de Wompi.
    if (this.isProduction) {
      const missing = [
        ['WOMPI_PUBLIC_KEY', this.publicKey],
        ['WOMPI_PRIVATE_KEY', this.privateKey],
        ['WOMPI_EVENT_INTEGRITY_SECRET', this.eventIntegritySecret],
      ]
        .filter(([, value]) => !value)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(
          `Configuración de Wompi incompleta en producción. Faltan: ${missing.join(', ')}`,
        );
      }
    }

    if (wantsStub && !this.stubMode) {
      this.logger.warn(
        `WOMPI_MODE=stub ignorado: solo se permite con NODE_ENV=development (actual: ${nodeEnv ?? 'vacío'})`,
      );
    }

    // Log configuración
    this.logger.log(
      `Iniciando Wompi Service (NODE_ENV=${nodeEnv ?? 'vacío'}, atajos de desarrollo: ${this.isDevelopment ? 'sí' : 'no'}, stub: ${this.stubMode ? 'sí' : 'no'})`,
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

  /**
   * Atajos inseguros de desarrollo (enlaces `myapp://payment-demo`, tokens y
   * transacciones simuladas, aprobar pagos sin Wompi). Solo con `NODE_ENV=development`.
   * También lo usan `SubscriptionsService` y `SubscriptionsController`.
   */
  get devShortcutsEnabled(): boolean {
    return this.isDevelopment;
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
      if (this.isDevelopment) {
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
        this.isDevelopment &&
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
        if (this.isDevelopment) {
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
      if (this.isDevelopment) {
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
      if (this.isDevelopment) {
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
      if (this.isDevelopment) {
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
      if (this.isDevelopment) {
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

      // Con links de pago (no suscripciones recurrentes de Wompi) no hay nada
      // que cancelar en Wompi: solo se registra el intento.
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

  /**
   * ¿El evento lo envió Wompi? Algoritmo oficial (2.07): `signature.properties`
   * (rutas dentro de `data`, en el orden del cuerpo) + `timestamp` + secreto de
   * eventos → SHA256 hex, comparado en tiempo constante con
   * `signature.checksum` (y con la cabecera `X-Event-Checksum` si llega).
   * Ver `subscriptions/wompi-event.ts`. Nunca registra la firma esperada.
   * Modo stub (solo `NODE_ENV=development`, 1.05): acepta todo.
   */
  verifyWebhookEvent(event: WompiEvent, headerChecksum?: string): boolean {
    if (this.stubMode) {
      this.logger.log(
        'Modo stub: Verificación de webhook simulada (siempre válida)',
      );
      return true;
    }
    if (!this.eventIntegritySecret) {
      this.logger.warn('WOMPI_EVENT_INTEGRITY_SECRET no configurado');
      return false;
    }
    return hasValidWompiChecksum(
      event,
      this.eventIntegritySecret,
      headerChecksum,
    );
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

  /**
   * Transacción más reciente de Wompi con esa referencia (`GET /transactions`,
   * con la llave privada), o `null` si no hay. La usa `refresh-status` para
   * aplicar el resultado con la misma regla que el webhook.
   * Stub o error en `NODE_ENV=development` → `null` (el atajo de desarrollo de
   * `refresh-status` decide); fuera de development el error se propaga.
   */
  async findLatestTransactionByReference(
    reference: string,
  ): Promise<WompiTransaction | null> {
    if (this.stubMode) {
      this.logger.log('Modo stub: sin consulta de transacciones a Wompi');
      return null;
    }
    try {
      const response = await axios.get(`${this.apiBaseUrl}/transactions`, {
        params: { reference },
        headers: this.getAuthHeaders(),
      });
      const transactions: unknown[] = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      const latest = transactions
        .filter(
          (t): t is { created_at?: string; reference?: unknown } =>
            typeof t === 'object' && t !== null,
        )
        .filter((t) => t.reference === reference)
        .sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime(),
        )[0];
      return latest ? parseWompiTransaction(latest) : null;
    } catch (error) {
      this.logger.error(`Error consultando transacciones: ${error.message}`);
      if (this.isDevelopment) return null;
      throw new Error(`Error verificando transacción: ${error.message}`);
    }
  }
}
