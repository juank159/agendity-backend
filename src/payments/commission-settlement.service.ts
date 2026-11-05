import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  endOfBusinessDay,
  startOfBusinessDay,
} from 'src/common/utils/date.util';
import { TenantSettingsService } from 'src/settings/tenant-settings.service';
import {
  CommissionSettlement,
  EmployeeCommissionSettlement,
  SettlementLine,
  settleCommissions,
  withoutBusinessShare,
} from 'src/appointments/appointment-commission';
import { AppointmentStatus } from 'src/common/enums/status.enum';
import { netAmountSql } from './payment-rules';

interface SettlementPeriod {
  /** Inicio y fin del periodo: días completos del negocio, en su zona. */
  start: Date;
  end: Date;
  timezone: string;
}

/**
 * Respuesta de `GET /payments/stats/commissions` para el Owner: lo ganado
 * (citas COMPLETED) en el nivel principal, como siempre, y lo por ganar
 * (PENDING/CONFIRMED, D-27) en `pending`, con la misma forma.
 */
export interface CommissionSettlementResponse
  extends SettlementPeriod,
    CommissionSettlement {
  pending: CommissionSettlement;
}

/** Para el Employee (D-27): igual, sin `business_total` en ningún nivel. */
export interface EmployeeCommissionSettlementResponse
  extends SettlementPeriod,
    EmployeeCommissionSettlement {
  pending: EmployeeCommissionSettlement;
}

/** Estados de cita que todavía pueden acabar completadas (lo por ganar). */
const PENDING_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

/**
 * Liquidación de comisiones (8.02, D-16) por periodo y profesional.
 * - Base: el precio guardado en cada línea de las citas **COMPLETED** del
 *   periodo (decisión del usuario), con el % congelado en la línea.
 * - `pending` (D-27): lo mismo con las citas PENDING y CONFIRMED del periodo
 *   (lo por ganar: la comisión aparece cuando el Owner la completa), con el
 *   estado, el estado de pago y lo pagado neto de cada cita.
 * - Employee: sin `business_total` (lo que le queda al negocio) en ningún
 *   nivel, tampoco en `pending`.
 * - Periodo: días completos del negocio en su zona, por la fecha de la cita.
 * - Owner: todos los profesionales (o uno con `professionalId`); Employee:
 *   solo lo suyo (pedir otro → 403).
 */
@Injectable()
export class CommissionSettlementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantSettings: TenantSettingsService,
  ) {}

  async settle(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    filter: { professionalId?: string; onlyProfessionalId?: string },
  ): Promise<
    CommissionSettlementResponse | EmployeeCommissionSettlementResponse
  > {
    const { onlyProfessionalId } = filter;
    if (
      onlyProfessionalId &&
      filter.professionalId &&
      filter.professionalId !== onlyProfessionalId
    ) {
      throw new ForbiddenException(
        'Solo puedes consultar tus propias comisiones',
      );
    }
    const professionalId = onlyProfessionalId ?? filter.professionalId ?? null;
    const timezone = await this.tenantSettings.getTimezone(tenantId);
    const start = startOfBusinessDay(startDate, timezone);
    const end = endOfBusinessDay(endDate, timezone);

    const rows: SettlementLine[] = await this.dataSource.query(
      `SELECT a.id AS "appointmentId", a."date" AS "date",
              a.timezone AS "timezone",
              TRIM(CONCAT_WS(' ', c.name, c.lastname)) AS "clientName",
              a.professional_id AS "professionalId",
              TRIM(CONCAT_WS(' ', u.name, u.lastname)) AS "professionalName",
              l.service_id AS "serviceId", s.name AS "serviceName",
              l.price AS "price",
              l.commission_percentage AS "commissionPercentage",
              a.status AS "status", a.payment_status AS "paymentStatus",
              paid.amount AS "paidAmount"
         FROM appointments a
         JOIN appointment_services l ON l.appointment_id = a.id
         JOIN services s ON s.id = l.service_id
         JOIN users u ON u.id = a.professional_id
         LEFT JOIN clients c ON c.id = a."clientId"
         -- Pagado neto como PaymentsService.loadPaidSummary (sin los pagos
         -- en revisión, 10.01b). Solo sale en pending.
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(${netAmountSql('p')}), 0) AS amount
             FROM payments p
            WHERE p."appointmentId" = a.id
              AND p.status = 'COMPLETED'
              AND p.review_required IS NULL
         ) paid
        WHERE a.owner_id = $1
          AND a.status::text = ANY($5::text[])
          AND a."date" BETWEEN $2 AND $3
          AND ($4::uuid IS NULL OR a.professional_id = $4::uuid)
        ORDER BY a."date", s.name`,
      [
        tenantId,
        start,
        end,
        professionalId,
        [AppointmentStatus.COMPLETED, ...PENDING_STATUSES],
      ],
    );
    const earned = settleCommissions(
      rows.filter((row) => row.status === AppointmentStatus.COMPLETED),
    );
    const pending = settleCommissions(
      rows.filter((row) => PENDING_STATUSES.includes(row.status!)),
      { withState: true },
    );
    const period = { start, end, timezone };
    return onlyProfessionalId
      ? {
          ...period,
          ...withoutBusinessShare(earned),
          pending: withoutBusinessShare(pending),
        }
      : { ...period, ...earned, pending };
  }
}
