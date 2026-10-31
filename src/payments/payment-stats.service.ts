import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentStatus } from '../common/enums/status.enum';
import { netAmountSql } from './payment-rules';
import { rethrowPaymentError } from './payment-errors';
import { PaymentStats } from './interfaces/payment-stats.interface';
import { ErrorHandlerOptions } from './interfaces/error-handler-options.interface';
import { PaymentMethodStats } from './interfaces/payment-method-stats.interface';
import { PaymentComparisonStats } from './interfaces/payment-comparison-stats.interface';
import {
  ServiceRevenueRow,
  ServiceStats,
} from './interfaces/service-stats.interface';
import { ProfessionalStats } from './interfaces/professional-stats.interface';
import { ClientStats } from './interfaces/client-stats.interface';
import {
  endOfBusinessDay,
  startOfBusinessDay,
} from '../common/utils/date.util';
import { TenantSettingsService } from '../settings/tenant-settings.service';

/**
 * Estadísticas de ingresos (5.05: separadas de `PaymentsService`, que solo
 * registra pagos y reembolsos). Solo lecturas, siempre acotadas al negocio
 * (`owner_id = tenantId`) y al periodo; ingresos netos con `netAmountSql`.
 * Las rutas siguen en `PaymentsController` (`/payments/stats*`,
 * `/payments/employee-stats`): el contrato HTTP no cambió.
 */
@Injectable()
export class PaymentStatsService {
  private readonly logger = new Logger(PaymentStatsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly tenantSettings: TenantSettingsService,
  ) {}

  /**
   * Días completos del negocio en SU zona (6.02): [00:00 del inicio, fin del
   * día de `endDate`]. `startDate`/`endDate` ya llegan interpretados en esa
   * zona (`@QueryDate`).
   */
  private async businessDays(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ start: Date; end: Date; timeZone: string }> {
    const timeZone = await this.tenantSettings.getTimezone(tenantId);
    return {
      start: startOfBusinessDay(startDate, timeZone),
      end: endOfBusinessDay(endDate, timeZone),
      timeZone,
    };
  }

  private handleError(error: any, options: ErrorHandlerOptions): never {
    rethrowPaymentError(this.logger, error, options);
  }

  /**
   * Ingreso neto por servicio (2.28), ÚNICA consulta de "por servicio" (la usan
   * `stats/by-service` y `employee-stats.by_service`). Lo pagado neto de cada
   * cita en el periodo (pagos COMPLETED, `amount − refund_amount`) se reparte
   * entre sus servicios en proporción a su precio (a partes iguales si todos
   * valen 0). Así cada cita cuenta una vez por servicio, tenga los pagos que
   * tenga, y la suma de todos los servicios = ingreso neto del periodo.
   * El reparto usa el precio de cada servicio guardado EN LA CITA
   * (`appointment_services.price`, 2.29), no el precio actual del catálogo:
   * cambiar un precio no altera los informes del pasado.
   */
  private async serviceRevenue(
    tenantId: string,
    start: Date,
    end: Date,
    professionalId?: string,
  ): Promise<ServiceRevenueRow[]> {
    const params: unknown[] = [
      tenantId,
      start.toISOString(),
      end.toISOString(),
    ];
    if (professionalId) params.push(professionalId);
    const rows = await this.paymentRepository.manager.query(
      `
      WITH paid AS (
        SELECT p."appointmentId" AS appointment_id,
               SUM(${netAmountSql('p')}) AS net,
               COUNT(*) AS payments
          FROM payments p
          JOIN appointments a ON a.id = p."appointmentId"
         WHERE p.owner_id = $1
           AND p.status = 'COMPLETED' AND p.review_required IS NULL
           AND p.created_at BETWEEN $2 AND $3
           ${professionalId ? 'AND a.professional_id = $4' : ''}
         GROUP BY p."appointmentId"
      ), lines AS (
        SELECT aps.appointment_id, s.id AS service_id, s.name AS service_name,
               aps.price,
               SUM(aps.price) OVER (PARTITION BY aps.appointment_id) AS appointment_price,
               COUNT(*) OVER (PARTITION BY aps.appointment_id) AS appointment_lines
          FROM appointment_services aps
          JOIN services s ON s.id = aps.service_id
         WHERE aps.appointment_id IN (SELECT appointment_id FROM paid)
      )
      SELECT l.service_id, l.service_name,
             COUNT(DISTINCT l.appointment_id) AS appointment_count,
             SUM(paid.payments) AS payment_count,
             SUM(paid.net * CASE WHEN l.appointment_price > 0
                                 THEN l.price / l.appointment_price
                                 ELSE 1.0 / l.appointment_lines END) AS total_amount
        FROM lines l
        JOIN paid ON paid.appointment_id = l.appointment_id
       GROUP BY l.service_id, l.service_name
       ORDER BY total_amount DESC
      `,
      params,
    );
    return rows.map((row: any) => ({
      service_id: row.service_id,
      service_name: row.service_name,
      appointment_count: Number(row.appointment_count) || 0,
      payment_count: Number(row.payment_count) || 0,
      total_amount: Math.round((Number(row.total_amount) || 0) * 100) / 100,
    }));
  }

  async getPaymentStats(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<PaymentStats> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // Una sola consulta agregada en la BD (2.26: antes cargaba y registraba
      // en el log TODOS los pagos del negocio en cada llamada).
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        // 10.01b: un pago en revisión no cuenta hasta resolverlo.
        .andWhere('payment.reviewRequired IS NULL')
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .select(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .addSelect('COUNT(*)', 'payment_count')
        .addSelect(`AVG(${netAmountSql('payment')})`, 'average_amount')
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

  async getEmployeeStats(
    professionalId: string,
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<any> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // Totales del profesional en el periodo (2.26: sin las consultas de
      // diagnóstico ni la misma suma repetida en SQL nativo).
      const result = await this.paymentRepository
        .createQueryBuilder('payment')
        .select(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .addSelect('COUNT(DISTINCT payment.id)', 'payment_count')
        .addSelect('COUNT(DISTINCT appointment.id)', 'appointment_count')
        .innerJoin('payment.appointment', 'appointment')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        // 10.01b: un pago en revisión no cuenta hasta resolverlo.
        .andWhere('payment.reviewRequired IS NULL')
        .andWhere('appointment.professional_id = :professionalId', {
          professionalId,
        })
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere(
          'payment.created_at BETWEEN :startDate AND :adjustedEndDate',
          {
            startDate,
            adjustedEndDate,
          },
        )
        .getRawOne();

      // Desglose por servicio: ingreso neto repartido (2.28, `serviceRevenue`)
      let serviceBreakdown: ServiceRevenueRow[] = [];
      try {
        serviceBreakdown = await this.serviceRevenue(
          tenantId,
          startDate,
          adjustedEndDate,
          professionalId,
        );
      } catch (serviceError) {
        this.logger.error(
          `Estadísticas del profesional: falló el desglose por servicio: ${serviceError?.message}`,
        );
        serviceBreakdown = [];
      }

      // Evolución diaria: pagos y citas por separado (2.28)
      let dailyStats = [];
      try {
        dailyStats = await this.paymentRepository.manager.query(
          `
        SELECT 
          to_char(p.created_at AT TIME ZONE $5::text, 'YYYY-MM-DD') as date,
          SUM(${netAmountSql('p')}) as daily_total,
          COUNT(DISTINCT p.id) as daily_count,
          COUNT(DISTINCT p."appointmentId") as daily_appointments
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED' AND p.review_required IS NULL
        AND a."professional_id" = $2
        AND p.created_at BETWEEN $3 AND $4
        GROUP BY 1
        ORDER BY 1 ASC
      `,
          [
            tenantId,
            professionalId,
            startDate.toISOString(),
            adjustedEndDate.toISOString(),
            days.timeZone,
          ],
        );
      } catch (dailyError) {
        this.logger.error(
          `Estadísticas del profesional: falló la evolución diaria: ${dailyError?.message}`,
        );
        dailyStats = [];
      }

      // Preparar respuesta con los datos obtenidos
      const totalAmount = Number(result?.total_amount) || 0;
      const paymentCount = Number(result?.payment_count) || 0;
      const summary = {
        total_amount: totalAmount,
        payment_count: paymentCount,
        appointment_count: Number(result?.appointment_count) || 0,
        average_per_payment: paymentCount > 0 ? totalAmount / paymentCount : 0,
      };

      return {
        summary: summary,
        // `count` = citas en las que se hizo el servicio (2.28: antes, pagos).
        by_service: serviceBreakdown.map((item) => ({
          service_id: item.service_id,
          service_name: item.service_name,
          count: item.appointment_count,
          total: item.total_amount,
        })),
        // `count` (= `payment_count`) son pagos, como antes; `appointment_count`
        // son las citas distintas que recibieron esos pagos (2.28).
        daily_evolution: dailyStats.map((item) => ({
          date: item.date,
          total: Number(item.daily_total || 0),
          count: Number(item.daily_count || 0),
          payment_count: Number(item.daily_count || 0),
          appointment_count: Number(item.daily_appointments || 0),
        })),
      };
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener estadísticas del profesional',
      });
    }
  }

  async getPaymentStatsByMethod(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<PaymentMethodStats[]> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // Métodos estándar y propios (2.28: antes solo los estándar, y los
      // porcentajes no sumaban 100). Un pago con método propio cuenta como
      // CUSTOM con el nombre del método; el porcentaje es sobre la suma de
      // todos los grupos (= ingreso neto del periodo).
      const rows = await this.paymentRepository.manager.query(
        `
        SELECT
          CASE WHEN p.custom_payment_method_id IS NOT NULL
               THEN COALESCE(cpm.name, 'Método propio')
               ELSE COALESCE(p.payment_method::text, 'SIN_METODO') END AS method,
          CASE WHEN p.custom_payment_method_id IS NOT NULL
               THEN 'CUSTOM' ELSE 'STANDARD' END AS method_type,
          p.custom_payment_method_id AS custom_payment_method_id,
          COUNT(*) AS count,
          SUM(${netAmountSql('p')}) AS total
        FROM payments p
        LEFT JOIN custom_payment_methods cpm
          ON cpm.id = p.custom_payment_method_id AND cpm.owner_id = p.owner_id
        WHERE p.owner_id = $1
          AND p.status = 'COMPLETED' AND p.review_required IS NULL
          AND p.created_at BETWEEN $2 AND $3
        GROUP BY 1, 2, 3
        `,
        [tenantId, startDate.toISOString(), adjustedEndDate.toISOString()],
      );
      const grandTotal = rows.reduce(
        (sum: number, item: any) => sum + (Number(item.total) || 0),
        0,
      );

      const results: PaymentMethodStats[] = rows.map((item: any) => {
        const count = Number(item.count) || 0;
        const total = Number(item.total) || 0;
        return {
          method: item.method,
          method_type: item.method_type,
          custom_payment_method_id: item.custom_payment_method_id ?? null,
          count,
          total,
          average: count > 0 ? total / count : 0,
          percentage: grandTotal > 0 ? (total * 100) / grandTotal : 0,
        };
      });

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
    tenantId: string,
  ): Promise<PaymentComparisonStats> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;
      const periodDuration = adjustedEndDate.getTime() - startDate.getTime();

      // Período anterior: misma duración y termina justo antes del actual
      const adjustedPreviousEndDate = new Date(startDate.getTime() - 1);
      const previousStartDate = new Date(
        adjustedPreviousEndDate.getTime() - periodDuration,
      );

      // Obtener estadísticas para ambos períodos
      const currentStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );
      const previousStats = await this.getPaymentStats(
        previousStartDate,
        adjustedPreviousEndDate,
        tenantId,
      );

      // Diferencias y cambios porcentuales. Con el periodo anterior en 0 el %
      // no existe: `null` (7.04-8; antes salía "↑ 100 %"), la app muestra
      // "nuevo" o "—".
      const amountDifference =
        currentStats.total_amount - previousStats.total_amount;
      const amountPercentage = percentChange(
        currentStats.total_amount,
        previousStats.total_amount,
      );

      const countDifference =
        currentStats.payment_count - previousStats.payment_count;
      const countPercentage = percentChange(
        currentStats.payment_count,
        previousStats.payment_count,
      );

      const averageDifference =
        currentStats.average_amount - previousStats.average_amount;
      const averagePercentage = percentChange(
        currentStats.average_amount,
        previousStats.average_amount,
      );

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
          amount_percentage: round2(amountPercentage),
          count_difference: countDifference,
          count_percentage: round2(countPercentage),
          average_difference: averageDifference,
          average_percentage: round2(averagePercentage),
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

  async getPaymentStatsByService(
    startDate: Date,
    endDate: Date,
    tenantId: string,
  ): Promise<ServiceStats[]> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // 2.28: ingreso neto real por servicio (antes, precio de lista × nº de
      // pagos: con varios pagos por cita se contaba varias veces y los
      // porcentajes pasaban de 100).
      const rows = await this.serviceRevenue(
        tenantId,
        startDate,
        adjustedEndDate,
      );
      const grandTotal = rows.reduce((sum, row) => sum + row.total_amount, 0);
      const result: ServiceStats[] = rows.map((row) => ({
        service_id: row.service_id,
        service_name: row.service_name,
        appointment_count: row.appointment_count,
        payment_count: row.payment_count,
        total_amount: row.total_amount,
        average_amount:
          row.appointment_count > 0
            ? row.total_amount / row.appointment_count
            : 0,
        percentage_of_total:
          grandTotal > 0 ? (row.total_amount * 100) / grandTotal : 0,
      }));

      // Ordenar por total_amount de mayor a menor
      result.sort((a, b) => b.total_amount - a.total_amount);

      return result;
    } catch (error) {
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
    tenantId: string,
  ): Promise<ProfessionalStats[]> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // Primero obtenemos el total general para calcular porcentajes
      const totalStats = await this.getPaymentStats(
        startDate,
        adjustedEndDate,
        tenantId,
      );

      // Verificar si hay pagos en el período
      if (totalStats.payment_count === 0) {
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
        .addSelect(`SUM(${netAmountSql('payment')})`, 'total_amount')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.professional', 'professional')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        // 10.01b: un pago en revisión no cuenta hasta resolverlo.
        .andWhere('payment.reviewRequired IS NULL')
        .andWhere('payment.ownerId = :tenantId', { tenantId })
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

      // Si no se encontraron profesionales
      if (result.length === 0) {
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
    tenantId: string,
    limit: number = 10,
  ): Promise<ClientStats[]> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      endDate = days.end;

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
        .addSelect(`SUM(${netAmountSql('payment')})`, 'total_spent')
        .innerJoin('payment.appointment', 'appointment')
        .innerJoin('appointment.client', 'client')
        .where('payment.status = :status', { status: PaymentStatus.COMPLETED })
        // 10.01b: un pago en revisión no cuenta hasta resolverlo.
        .andWhere('payment.reviewRequired IS NULL')
        .andWhere('payment.ownerId = :tenantId', { tenantId })
        .andWhere('payment.created_at BETWEEN :startDate AND :endDate', {
          startDate,
          endDate,
        })
        .groupBy('client.id, client.name, client.lastname')
        .orderBy('total_spent', 'DESC')
        // Desempate estable por id: el LIMIT no elige al azar.
        .addOrderBy('client.id', 'ASC')
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
    tenantId: string,
    limit: number = 5,
  ): Promise<any[]> {
    try {
      // Días completos del negocio, en la zona del tenant (6.02)
      const days = await this.businessDays(tenantId, startDate, endDate);
      startDate = days.start;
      const adjustedEndDate = days.end;

      // Consulta SQL nativa simplificada
      const entityManager = this.paymentRepository.manager;
      // Consulta parametrizada: nada del usuario se interpola en el SQL
      const topClients = await entityManager.query(
        `
        SELECT 
          c.id as client_id,
          CONCAT(c.name, ' ', COALESCE(c.lastname, '')) as client_name,
          COUNT(DISTINCT a.id) as visit_count,
          SUM(${netAmountSql('p')}) as total_spent
        FROM payments p
        JOIN appointments a ON p."appointmentId" = a.id
        JOIN clients c ON a."clientId" = c.id
        WHERE p.owner_id = $1
        AND p.status = 'COMPLETED' AND p.review_required IS NULL
        AND p.created_at BETWEEN $2 AND $3
        GROUP BY c.id, c.name, c.lastname
        -- Desempate estable: a igual gasto, por id (el LIMIT no elige al azar).
        ORDER BY total_spent DESC, c.id ASC
        LIMIT $4
      `,
        [
          tenantId,
          startDate.toISOString(),
          adjustedEndDate.toISOString(),
          limit,
        ],
      );

      return topClients.map((client) => ({
        client_id: client.client_id,
        client_name: client.client_name,
        visit_count: Number(client.visit_count) || 0,
        total_spent: Number(client.total_spent) || 0,
      }));
    } catch (error) {
      this.handleError(error, {
        entity: 'los pagos',
        operation: 'buscar',
        detail: 'al obtener mejores clientes',
      });
    }
  }
}

/**
 * Cambio porcentual del periodo anterior al actual (7.04-8). `null` si el
 * anterior es 0: no hay base y "100 %" sería falso.
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (!previous) return null;
  return ((current - previous) * 100) / previous;
}

/** 2 decimales, como antes; `null` se queda en `null`. */
function round2(value: number | null): number | null {
  return value === null ? null : parseFloat(value.toFixed(2));
}
