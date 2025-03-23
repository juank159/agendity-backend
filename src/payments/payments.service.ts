import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { AppointmentsService } from '../appointments/appointments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppointmentStatus, PaymentStatus } from '../common/enums/status.enum';
import {
  NotificationType,
  ReceiverType,
} from '../notifications/entities/notification.entity';
import { RELATIONS } from './constants/payment-relations.constants';
import { PaymentStats } from './interfaces/payment-stats.interface';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { PaymentNotification } from './interfaces/payment-notification.interface';
import { CustomPaymentMethodsService } from './custom-payment-methods.service';
import { PaymentMethodStats } from './interfaces/payment-method-stats.interface';
import { PaymentComparisonStats } from './interfaces/payment-comparison-stats.interface';
import { ServiceStats } from './interfaces/service-stats.interface';
import { ProfessionalStats } from './interfaces/professional-stats.interface';
import { ClientStats } from './interfaces/client-stats.interface';
import { PaymentRepository } from './repositories/payment.repository';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly appointmentsService: AppointmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly customPaymentMethodsService: CustomPaymentMethodsService,
  ) {}

  private handleError(error: any, options: ErrorHandlerOptions): never {
    console.error(`Error al ${options.operation} ${options.entity}:`, error);

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

    throw new InternalServerErrorException(
      `Error al ${options.operation} ${options.entity}. Por favor, intenta nuevamente.`,
    );
  }

  private async validateExistingPayment(appointmentId: string): Promise<void> {
    // Modifiquemos este método para depurar
    console.log(`Validando si existe pago para cita: ${appointmentId}`);

    const existingPayment = await this.paymentRepository.findOne({
      where: {
        appointment: { id: appointmentId },
        status: PaymentStatus.COMPLETED,
      },
    });

    console.log(`Resultado de búsqueda de pago existente:`, existingPayment);

    if (existingPayment) {
      throw new BadRequestException(
        'Ya existe un pago completado para esta cita',
      );
    }
  }

  private async sendPaymentNotification(
    notification: PaymentNotification,
    isRefund = false,
  ): Promise<void> {
    await this.notificationsService.create({
      receiver_id: notification.receiver_id,
      receiver_type: ReceiverType.CLIENT,
      type: NotificationType.PAYMENT_CONFIRMATION,
      title: isRefund ? 'Reembolso Procesado' : 'Pago Confirmado',
      message: isRefund
        ? `Se ha procesado un reembolso de $${notification.payment_amount}`
        : `Tu pago de $${notification.payment_amount} ha sido procesado exitosamente`,
      metadata: {
        appointment_id: notification.appointment_id,
        payment_id: notification.payment_id,
      },
    });
  }

  private async updatePaymentDates(paymentId: string): Promise<void> {
    try {
      console.log(`Actualizando fechas para pago: ${paymentId}`);

      // Usa SQL nativo para actualizar directamente las fechas
      // Cambiamos para usar la zona horaria explícitamente
      await this.paymentRepository.query(
        `
        UPDATE payments 
        SET created_at = (NOW() AT TIME ZONE 'America/Bogota'), 
            updated_at = (NOW() AT TIME ZONE 'America/Bogota')
        WHERE id = $1
      `,
        [paymentId],
      );

      console.log(`Fechas actualizadas exitosamente`);
    } catch (error) {
      console.error(`Error al actualizar fechas:`, error);
      throw error; // Re-lanzar para que se maneje en el método create
    }
  }

  async create(
    createPaymentDto: CreatePaymentDto,
    userId: string,
  ): Promise<Payment> {
    try {
      const appointment = await this.appointmentsService.findOne(
        createPaymentDto.appointment_id,
        userId,
      );

      await this.validateExistingPayment(appointment.id);

      // Validaciones habituales...

      // PASO 1: Verificamos la configuración de zona horaria
      const timeCheck = await this.paymentRepository.query(`
        SELECT NOW() as current_time, CURRENT_SETTING('TIMEZONE') as db_timezone
      `);
      console.log('Información antes de crear pago:', timeCheck[0]);

      // PASO 2: Crear objeto pago
      const payment = this.paymentRepository.create({
        amount: createPaymentDto.amount,
        payment_method: createPaymentDto.payment_method,
        custom_payment_method_id: createPaymentDto.custom_payment_method_id,
        transaction_id: createPaymentDto.transaction_id,
        payment_details: createPaymentDto.payment_details,
        appointment,
        status: PaymentStatus.COMPLETED,
        ownerId: userId,
      });

      // PASO 3: Guardar inicialmente
      const savedPayment = await this.paymentRepository.save(payment);
      console.log('Pago guardado con ID:', savedPayment.id);

      // PASO 4: Actualizar las fechas
      await this.paymentRepository.query(
        `
        UPDATE payments 
        SET 
          created_at = (NOW() AT TIME ZONE 'UTC' - INTERVAL '5 hours'), 
          updated_at = (NOW() AT TIME ZONE 'UTC' - INTERVAL '5 hours')
        WHERE id = $1
      `,
        [savedPayment.id],
      );

      // Verificar fechas
      const checkUpdated = await this.paymentRepository.query(
        `
        SELECT created_at, updated_at FROM payments WHERE id = $1
      `,
        [savedPayment.id],
      );
      console.log('Fechas actualizadas:', checkUpdated[0]);

      // PASO 5: Actualizar el estado de la cita
      await this.appointmentsService.update(
        appointment.id,
        {
          status: AppointmentStatus.CONFIRMED,
          payment_status: PaymentStatus.COMPLETED,
        },
        userId,
      );

      // PASO 6: Enviar notificación
      await this.sendPaymentNotification({
        receiver_id: appointment.client.id,
        payment_amount: payment.amount,
        appointment_id: appointment.id,
        payment_id: savedPayment.id,
      });

      // PASO 7: Recuperar el pago (sin usar relaciones complejas)
      // Esta es la línea que está causando el error, la simplificamos
      try {
        const completePayment = await this.paymentRepository.findOne({
          where: { id: savedPayment.id },
          relations: ['appointment'], // Simplificamos las relaciones
        });
        return completePayment;
      } catch (error) {
        console.error('Error al recuperar el pago completo:', error);
        // Si falla, devolver el pago original guardado
        return savedPayment;
      }
    } catch (error) {
      console.error('Error al crear el pago:', error);
      this.handleError(error, {
        entity: 'el pago',
        operation: 'crear',
      });
    }
  }

  // Método de diagnóstico corregido
  async diagnoseTimezoneProblem(): Promise<any> {
    try {
      console.log('============= DIAGNÓSTICO DE ZONA HORARIA =============');

      // 1. Hora del sistema JavaScript
      const jsNow = new Date();
      console.log('Hora actual de JavaScript:', jsNow);
      console.log('Hora actual en formato ISO:', jsNow.toISOString());
      console.log(
        'Offset de la zona horaria (minutos):',
        jsNow.getTimezoneOffset(),
      );
      console.log('Hora local formateada:', jsNow.toLocaleString());

      // 2. Hora de la base de datos PostgreSQL
      const pgTimeQuery = await this.paymentRepository.query(`
      SELECT 
        NOW() as pg_now,
        CURRENT_TIMESTAMP as current_timestamp,
        LOCALTIMESTAMP as local_timestamp,
        CURRENT_SETTING('TIMEZONE') as timezone_setting,
        NOW() AT TIME ZONE 'UTC' as now_utc,
        NOW() AT TIME ZONE 'America/Bogota' as now_bogota
    `);
      console.log('Información de hora de PostgreSQL:', pgTimeQuery[0]);

      // 3. Prueba directa con SQL
      console.log('Ejecutando prueba directa con SQL...');

      // Crear una tabla temporal para la prueba
      await this.paymentRepository.query(`
      CREATE TEMPORARY TABLE IF NOT EXISTS timezone_test (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ,
        method_name TEXT
      );
    `);

      // Insertar con diferentes métodos
      await this.paymentRepository.query(`
      INSERT INTO timezone_test (created_at, method_name) VALUES 
      (NOW(), 'NOW()'),
      (CURRENT_TIMESTAMP, 'CURRENT_TIMESTAMP'),
      (NOW() AT TIME ZONE 'UTC', 'NOW() AT TIME ZONE UTC'),
      (NOW() AT TIME ZONE 'America/Bogota', 'NOW() AT TIME ZONE America/Bogota');
    `);

      // Recuperar resultados
      const testResults = await this.paymentRepository.query(`
      SELECT * FROM timezone_test;
    `);

      console.log('Resultados de prueba con diferentes métodos de timestamp:');
      testResults.forEach((result) => {
        console.log(`${result.method_name}: ${result.created_at}`);
      });

      // Limpiar tabla temporal
      await this.paymentRepository.query(`DROP TABLE IF EXISTS timezone_test;`);

      console.log('============= FIN DIAGNÓSTICO =============');

      // Retornar la información recopilada
      return {
        javascriptTime: {
          now: jsNow,
          iso: jsNow.toISOString(),
          timezoneOffset: jsNow.getTimezoneOffset(),
          localeString: jsNow.toLocaleString(),
        },
        postgresTime: pgTimeQuery[0],
        testResults: testResults,
      };
    } catch (error) {
      console.error('Error en diagnóstico de zona horaria:', error);
      throw error;
    }
  }

  // Agrega este método en tu PaymentsService

  async findAll(userId: string): Promise<Payment[]> {
    try {
      return await this.paymentRepository.find({
        where: { ownerId: userId },
        relations: RELATIONS.APPOINTMENT_WITH_CUSTOM_METHOD,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'listar',
      });
    }
  }

  async findByAppointment(
    appointmentId: string,
    userId: string,
  ): Promise<Payment[]> {
    try {
      await this.appointmentsService.findOne(appointmentId, userId);

      return await this.paymentRepository.find({
        where: {
          appointment: { id: appointmentId },
          ownerId: userId,
        },
        relations: RELATIONS.MINIMAL,
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
      });
    }
  }

  async findOne(id: string, userId: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({
      where: {
        id,
        ownerId: userId,
      },
      relations: RELATIONS.APPOINTMENT,
    });

    if (!payment) {
      throw new NotFoundException(`Pago con ID ${id} no encontrado`);
    }

    return payment;
  }

  async refund(
    id: string,
    refundDto: RefundPaymentDto,
    userId: string,
  ): Promise<Payment> {
    try {
      const payment = await this.findOne(id, userId);

      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new BadRequestException(
          'Solo se pueden reembolsar pagos completados',
        );
      }

      if (refundDto.refund_amount > payment.amount) {
        throw new BadRequestException(
          'El monto del reembolso no puede ser mayor al pago original',
        );
      }

      payment.status = PaymentStatus.REFUNDED;
      payment.refund_amount = refundDto.refund_amount;
      payment.refund_reason = refundDto.refund_reason;

      const refundedPayment = await this.paymentRepository.save(payment);

      // Actualizar el estado de la cita cuando se hace un reembolso
      await this.appointmentsService.update(
        payment.appointment.id,
        {
          payment_status: PaymentStatus.REFUNDED,
        },
        userId,
      );

      await this.sendPaymentNotification(
        {
          receiver_id: payment.appointment.client.id,
          payment_amount: refundDto.refund_amount,
          appointment_id: payment.appointment.id,
          payment_id: payment.id,
        },
        true,
      );

      return refundedPayment;
    } catch (error) {
      this.handleError(error, {
        entity: 'el pago',
        operation: 'reembolsar',
      });
    }
  }

  async getPaymentStats(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<PaymentStats> {
    try {
      // Asegúrate de que endDate incluya todo el día (hasta las 23:59:59.999)
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999); // Usa UTC para evitar problemas de zona horaria

      console.log(
        'Buscando pagos entre fechas:',
        startDate,
        'y',
        adjustedEndDate,
      );

      // Obtener todos los pagos para depuración
      const allPayments = await this.paymentRepository.find({
        where: {
          status: PaymentStatus.COMPLETED,
          ownerId: userId,
        },
      });
      console.log(
        `Todos los pagos del usuario (${allPayments.length}):`,
        allPayments,
      );

      // Filtrar manualmente los pagos por fecha para depuración
      const filteredPayments = allPayments.filter((payment) => {
        const paymentDate = new Date(payment.created_at);
        return paymentDate >= startDate && paymentDate <= adjustedEndDate;
      });
      console.log(
        `Pagos filtrados (${filteredPayments.length}):`,
        filteredPayments,
      );

      // Realizar la consulta normal
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .select('SUM(payment.amount)', 'total_amount')
        .addSelect('COUNT(*)', 'payment_count')
        .addSelect('AVG(payment.amount)', 'average_amount')
        .getRawOne();

      return {
        total_amount: Number(result.total_amount) || 0,
        payment_count: Number(result.payment_count) || 0,
        average_amount: Number(result.average_amount) || 0,
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al calcular estadísticas',
      });
    }
  }

  async getPaymentStatsByMethod(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<PaymentMethodStats[]> {
    try {
      // Asegúrate de que endDate incluya todo el día
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999);

      console.log(
        'Buscando estadísticas por método de pago entre fechas:',
        startDate,
        'y',
        adjustedEndDate,
      );

      // Obtener el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        userId,
      );

      // Consulta para pagos con métodos estándar
      const standardMethodsQuery = this.paymentRepository
        .createQueryBuilder('payment')
        .select('payment.payment_method', 'method')
        .addSelect("'STANDARD'", 'method_type')
        .addSelect('COUNT(*)', 'count')
        .addSelect('SUM(payment.amount)', 'total')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .andWhere('payment.payment_method IS NOT NULL')
        .groupBy('payment.payment_method');

      // Hacer la consulta para métodos estándar
      const standardResults = await standardMethodsQuery.getRawMany();
      console.log('Resultados por método estándar:', standardResults);

      // Transformar los resultados
      const results = standardResults.map((item) => ({
        method: item.method,
        method_type: item.method_type,
        count: Number(item.count) || 0,
        total: Number(item.total) || 0,
        average:
          Number(item.count) > 0 ? Number(item.total) / Number(item.count) : 0,
        percentage:
          totalStats.total_amount > 0
            ? (Number(item.total) * 100) / totalStats.total_amount
            : 0,
      }));

      // Ordenar por total (de mayor a menor)
      return results.sort((a, b) => b.total - a.total);
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por método de pago',
      });
    }
  }

  async getPaymentStatsComparison(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<PaymentComparisonStats> {
    try {
      // Calcular la duración del período actual en milisegundos
      const periodDuration = endDate.getTime() - startDate.getTime();

      // Asegurarse de que las fechas finales incluyan todo el día (23:59:59.999)
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999);

      // Calcular fechas para el período anterior (mismo rango de tiempo)
      const previousEndDate = new Date(startDate.getTime() - 1); // Un milisegundo antes del inicio del período actual
      const previousStartDate = new Date(
        previousEndDate.getTime() - periodDuration,
      );

      // Ajustar la fecha final del período anterior también
      const adjustedPreviousEndDate = new Date(previousEndDate);
      adjustedPreviousEndDate.setHours(23, 59, 59, 999);

      console.log('Período actual:', startDate, 'a', adjustedEndDate);
      console.log(
        'Período anterior:',
        previousStartDate,
        'a',
        adjustedPreviousEndDate,
      );

      // Obtener estadísticas para ambos períodos
      const currentStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        userId,
      );
      const previousStats = await this.getPaymentStats(
        previousStartDate,
        adjustedPreviousEndDate,
        userId,
      );

      // Calcular diferencias y cambios porcentuales
      const amountDifference =
        currentStats.total_amount - previousStats.total_amount;
      const amountPercentage =
        previousStats.total_amount !== 0
          ? (amountDifference * 100) / previousStats.total_amount
          : currentStats.total_amount > 0
            ? 100
            : 0;

      const countDifference =
        currentStats.payment_count - previousStats.payment_count;
      const countPercentage =
        previousStats.payment_count !== 0
          ? (countDifference * 100) / previousStats.payment_count
          : currentStats.payment_count > 0
            ? 100
            : 0;

      const averageDifference =
        currentStats.average_amount - previousStats.average_amount;
      const averagePercentage =
        previousStats.average_amount !== 0
          ? (averageDifference * 100) / previousStats.average_amount
          : currentStats.average_amount > 0
            ? 100
            : 0;

      return {
        current_period: {
          start_date: startDate,
          end_date: adjustedEndDate,
          total_amount: currentStats.total_amount,
          payment_count: currentStats.payment_count,
          average_amount: currentStats.average_amount,
        },
        previous_period: {
          start_date: previousStartDate,
          end_date: adjustedPreviousEndDate,
          total_amount: previousStats.total_amount,
          payment_count: previousStats.payment_count,
          average_amount: previousStats.average_amount,
        },
        change: {
          amount_difference: amountDifference,
          amount_percentage: parseFloat(amountPercentage.toFixed(2)),
          count_difference: countDifference,
          count_percentage: parseFloat(countPercentage.toFixed(2)),
          average_difference: averageDifference,
          average_percentage: parseFloat(averagePercentage.toFixed(2)),
        },
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'comparar',
        detail: 'al obtener comparativa de períodos',
      });
    }
  }

  // RENDIMIENTO POR SERVICIO
  // async getPaymentStatsByService(
  //   startDate: Date,
  //   endDate: Date,
  //   userId: string,
  // ): Promise<ServiceStats[]> {
  //   try {
  //     // Ajustar la fecha final para incluir todo el día
  //     const adjustedEndDate = new Date(endDate);
  //     adjustedEndDate.setUTCHours(23, 59, 59, 999);

  //     console.log(
  //       'Buscando estadísticas por servicio entre fechas:',
  //       startDate,
  //       'y',
  //       adjustedEndDate,
  //     );

  //     // Primero obtenemos el total general para calcular porcentajes
  //     const totalStats = await this.getPaymentStats(
  //       startDate,
  //       adjustedEndDate,
  //       userId,
  //     );
  //     console.log('Total general de pagos:', totalStats);

  //     // Obtener servicios con sus precios
  //     const servicesWithPrices = await this.paymentRepository.manager
  //       .createQueryBuilder()
  //       .select('s.id', 'id')
  //       .addSelect('s.name', 'name')
  //       .addSelect('s.price', 'price')
  //       .from('services', 's')
  //       .where('s.ownerId = :userId', { userId })
  //       .getRawMany();

  //     console.log('Servicios con precios:', servicesWithPrices);

  //     // Crear un mapa de precios de servicios
  //     const servicePrices = {};
  //     for (const service of servicesWithPrices) {
  //       servicePrices[service.id] = Number(service.price) || 0;
  //     }

  //     // Consulta SQL para contar servicios y frecuencia
  //     const entityManager = this.paymentRepository.manager;
  //     const query = `
  //       SELECT
  //         s.id as service_id,
  //         s.name as service_name,
  //         COUNT(*) as usage_count
  //       FROM payments p
  //       JOIN appointments a ON p."appointmentId" = a.id
  //       JOIN appointment_services aps ON a.id = aps.appointment_id
  //       JOIN services s ON aps.service_id = s.id
  //       WHERE p.owner_id = $1
  //       AND p.status = 'COMPLETED'
  //       AND p.created_at BETWEEN $2 AND $3
  //       GROUP BY s.id, s.name
  //       ORDER BY usage_count DESC
  //     `;

  //     const serviceUsage = await entityManager.query(query, [
  //       userId,
  //       startDate.toISOString(),
  //       adjustedEndDate.toISOString(),
  //     ]);

  //     console.log('Uso de servicios:', serviceUsage);

  //     // Procesar los resultados utilizando los precios de los servicios
  //     const result = serviceUsage.map((item) => {
  //       const serviceId = item.service_id;
  //       const usageCount = Number(item.usage_count) || 0;
  //       const price = servicePrices[serviceId] || 0;
  //       const totalAmount = price * usageCount;

  //       return {
  //         service_id: serviceId,
  //         service_name: item.service_name,
  //         payment_count: usageCount,
  //         total_amount: totalAmount,
  //         average_amount: price,
  //         percentage_of_total:
  //           totalStats.total_amount > 0
  //             ? (totalAmount * 100) / totalStats.total_amount
  //             : 0,
  //       };
  //     });

  //     console.log('Resultados procesados finales:', result);

  //     return result;
  //   } catch (error) {
  //     console.error('Error en getPaymentStatsByService:', error);
  //     this.handleError(error, {
  //       entity: 'los pagos',
  //       operation: 'buscar',
  //       detail: 'al obtener estadísticas por servicio',
  //     });
  //   }
  // }

  async getPaymentStatsByService(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<ServiceStats[]> {
    try {
      // Ajustar la fecha final para incluir todo el día
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999);

      console.log(
        'Buscando estadísticas por servicio entre fechas:',
        startDate,
        'y',
        adjustedEndDate,
      );

      // Obtener el total general de pagos para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        userId,
      );
      console.log('Total general de pagos:', totalStats);

      // Obtener servicios con sus precios
      const servicesWithPrices = await this.paymentRepository.manager
        .createQueryBuilder()
        .select('s.id', 'id')
        .addSelect('s.name', 'name')
        .addSelect('s.price', 'price')
        .from('services', 's')
        .where('s.ownerId = :userId', { userId })
        .getRawMany();

      console.log('Servicios con precios:', servicesWithPrices);

      // Crear un mapa de precios de servicios
      const servicePrices = {};
      for (const service of servicesWithPrices) {
        servicePrices[service.id] = Number(service.price) || 0;
      }

      // Consulta SQL para contar servicios y frecuencia
      const entityManager = this.paymentRepository.manager;
      const query = `
        SELECT 
          s.id as service_id,
          s.name as service_name,
          COUNT(*) as usage_count
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN appointment_services aps ON a.id = aps.appointment_id
        JOIN services s ON aps.service_id = s.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED'
        AND p.created_at BETWEEN $2 AND $3
        GROUP BY s.id, s.name
        ORDER BY usage_count DESC
      `;

      const serviceUsage = await entityManager.query(query, [
        userId,
        startDate.toISOString(),
        adjustedEndDate.toISOString(),
      ]);

      console.log('Uso de servicios:', serviceUsage);

      // Procesar los resultados utilizando los precios de los servicios
      const result = serviceUsage.map((item) => {
        const serviceId = item.service_id;
        const usageCount = Number(item.usage_count) || 0;
        const price = servicePrices[serviceId] || 0;
        const totalAmount = price * usageCount;

        return {
          service_id: serviceId,
          service_name: item.service_name,
          payment_count: usageCount,
          total_amount: totalAmount,
          average_amount: price,
          percentage_of_total:
            totalStats.total_amount > 0
              ? (totalAmount * 100) / totalStats.total_amount
              : 0,
        };
      });

      console.log('Resultados procesados finales (antes de ordenar):', result);

      // Ordenar por total_amount de mayor a menor
      result.sort((a, b) => b.total_amount - a.total_amount);

      console.log('Resultados ordenados finales:', result);

      return result;
    } catch (error) {
      console.error('Error en getPaymentStatsByService:', error);
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por servicio',
      });
    }
  }

  async getPaymentStatsByProfessional(
    startDate: Date,
    endDate: Date,
    userId: string,
  ): Promise<ProfessionalStats[]> {
    try {
      // Asegúrate de que endDate incluya todo el día (hasta las 23:59:59.999)
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999);

      console.log(
        'Buscando estadísticas por profesional entre fechas:',
        startDate,
        'y',
        adjustedEndDate,
      );
      console.log('Usuario ID:', userId);

      // Primero obtenemos el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        userId,
      );
      console.log('Total stats encontrados:', totalStats);

      // Verificar si hay pagos en el período
      if (totalStats.payment_count === 0) {
        console.log('No se encontraron pagos en el período seleccionado');
        return []; // Retornar array vacío si no hay pagos
      }

      // Consulta para estadísticas por profesional
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('professional.id', 'professional_id')
        .addSelect(
          "CONCAT(professional.name, ' ', COALESCE(professional.lastname, ''))",
          'professional_name',
        )
        .addSelect('COUNT(DISTINCT appointment.id)', 'appointment_count')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect('SUM(payment.amount)', 'total_amount')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.professional', 'professional')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .groupBy('professional.id, professional.name, professional.lastname')
        .orderBy('total_amount', 'DESC')
        .getRawMany();

      console.log('Resultados de profesionales encontrados:', result);

      // Si no se encontraron profesionales
      if (result.length === 0) {
        console.log('No se encontraron profesionales asociados a los pagos');
        return [];
      }

      // Procesar y enriquecer los resultados
      return result.map((item) => ({
        professional_id: item.professional_id,
        professional_name: item.professional_name,
        appointment_count: Number(item.appointment_count) || 0,
        payment_count: Number(item.payment_count) || 0.0,
        total_amount: Number(item.total_amount) || 0,
        average_per_payment:
          Number(item.payment_count) > 0
            ? Number(item.total_amount) / Number(item.payment_count)
            : 0,
        percentage_of_total:
          totalStats.total_amount > 0
            ? (Number(item.total_amount) * 100) / totalStats.total_amount
            : 0,
      }));
    } catch (error) {
      console.error('Error en getPaymentStatsByProfessional:', error);
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por profesional',
      });
    }
  }

  async getPaymentStatsByClient(
    startDate: Date,
    endDate: Date,
    userId: string,
    limit: number = 10,
  ): Promise<ClientStats[]> {
    try {
      // Consulta para obtener estadísticas básicas por cliente
      const clientsQuery = await this.paymentRepository
        .createQueryBuilder('payment')
        .select('client.id', 'client_id')
        .addSelect(
          "CONCAT(client.name, ' ', COALESCE(client.lastname, ''))",
          'client_name',
        )
        .addSelect('MIN(appointment.date)', 'first_visit_date') // Ajustado a appointment.date
        .addSelect('MAX(appointment.date)', 'last_visit_date') // Ajustado a appointment.date
        .addSelect('COUNT(DISTINCT appointment.id)', 'visit_count')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect('SUM(payment.amount)', 'total_spent')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.client', 'client')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        .andWhere('payment.ownerId = :userId', { userId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('client.id, client.name, client.lastname')
        .orderBy('total_spent', 'DESC')
        .limit(limit)
        .getRawMany();

      // Procesamos los resultados y calculamos métricas adicionales
      return clientsQuery.map((client) => {
        const firstVisit = new Date(client.first_visit_date);
        const lastVisit = new Date(client.last_visit_date);

        // Calculamos la frecuencia promedio (días entre visitas)
        let frequency = 0;
        if (client.visit_count > 1) {
          const daysDiff = Math.floor(
            (lastVisit.getTime() - firstVisit.getTime()) /
              (1000 * 60 * 60 * 24),
          );
          frequency = Math.floor(daysDiff / (client.visit_count - 1));
        }

        return {
          client_id: client.client_id,
          client_name: client.client_name,
          first_visit_date: firstVisit,
          last_visit_date: lastVisit,
          visit_count: Number(client.visit_count) || 0,
          payment_count: Number(client.payment_count) || 0,
          total_spent: Number(client.total_spent) || 0,
          average_per_payment:
            Number(client.payment_count) > 0
              ? Number(client.total_spent) / Number(client.payment_count)
              : 0,
          frequency_days: frequency,
        };
      });
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas por cliente',
      });
    }
  }

  async getTopClients(
    startDate: Date,
    endDate: Date,
    userId: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      // Ajustar la fecha final para incluir todo el día
      const adjustedEndDate = new Date(endDate);
      adjustedEndDate.setUTCHours(23, 59, 59, 999);

      console.log(
        'Buscando mejores clientes entre fechas:',
        startDate,
        'y',
        adjustedEndDate,
      );

      // Consulta SQL nativa simplificada
      const entityManager = this.paymentRepository.manager;
      const topClients = await entityManager.query(`
        SELECT 
          c.id as client_id,
          CONCAT(c.name, ' ', COALESCE(c.lastname, '')) as client_name,
          COUNT(DISTINCT a.id) as visit_count,
          SUM(p.amount) as total_spent
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN clients c ON a."clientId" = c.id
        WHERE p.owner_id = '${userId}'
        AND p.status = 'COMPLETED'
        AND p.created_at BETWEEN '${startDate.toISOString()}' AND '${adjustedEndDate.toISOString()}'
        GROUP BY c.id, c.name, c.lastname
        ORDER BY total_spent DESC
        LIMIT ${limit}
      `);

      console.log('Resultados:', topClients);

      return topClients.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        visit_count: Number(client.visit_count) || 0,
        total_spent: Number(client.total_spent) || 0,
      }));
    } catch (error) {
      console.error('Error en getTopClients:', error);
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener mejores clientes',
      });
    }
  }
}
