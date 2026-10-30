import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  endOfBusinessDay,
  startOfBusinessDay,
} from 'src/common/utils/date.util';
import { TenantSettingsService } from 'src/settings/tenant-settings.service';
import {
  CommissionSettlement,
  SettlementLine,
  settleCommissions,
} from 'src/appointments/appointment-commission';

/** Respuesta de `GET /payments/stats/commissions`. */
export interface CommissionSettlementResponse extends CommissionSettlement {
  /** Inicio y fin del periodo: días completos del negocio, en su zona. */
  start: Date;
  end: Date;
  timezone: string;
}

/**
 * Liquidación de comisiones (8.02, D-16) por periodo y profesional.
 * - Base: el precio guardado en cada línea de las citas **COMPLETED** del
 *   periodo (decisión del usuario), con el % congelado en la línea.
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
  ): Promise<CommissionSettlementResponse> {
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
              l.commission_percentage AS "commissionPercentage"
         FROM appointments a
         JOIN appointment_services l ON l.appointment_id = a.id
         JOIN services s ON s.id = l.service_id
         JOIN users u ON u.id = a.professional_id
         LEFT JOIN clients c ON c.id = a."clientId"
        WHERE a.owner_id = $1
          AND a.status = 'COMPLETED'
          AND a."date" BETWEEN $2 AND $3
          AND ($4::uuid IS NULL OR a.professional_id = $4::uuid)
        ORDER BY a."date", s.name`,
      [tenantId, start, end, professionalId],
    );
    return { start, end, timezone, ...settleCommissions(rows) };
  }
}
