import { toCents } from 'src/payments/payment-rules';
import { centsToDecimal } from './appointment-pricing';

/**
 * Comisiones (8.02, D-16). Reglas puras.
 * - % efectivo de un servicio = la excepción del profesional para ese
 *   servicio (`user_services.commissionPercentage`) si existe; si no, su
 *   comisión general (`users.commission_percentage`); si no, 0.
 * - Se congela en la línea de la cita (`appointment_services.commission_percentage`).
 * - Comisión de una línea = precio de la línea × % (redondeada al centavo);
 *   el negocio se queda con el resto.
 */

type Percent = number | string | null | undefined;

/** % con 2 decimales como lo guarda `numeric(5,2)` (`"30.00"`). */
export function percentToDecimal(percent: Percent): string {
  const value = Number(percent);
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

export function effectiveCommission(
  exception: Percent,
  general: Percent,
): string {
  return percentToDecimal(exception != null ? exception : (general ?? 0));
}

/** Comisión en centavos de una línea: precio × % redondeado al centavo. */
export function commissionCents(price: Percent, percent: Percent): number {
  const hundredths = Math.round(Number(percent ?? 0) * 100);
  return Math.round((toCents(price ?? 0) * hundredths) / 10_000);
}

/** Línea de una cita COMPLETED para la liquidación. */
export interface SettlementLine {
  appointmentId: string;
  date: Date;
  timezone: string;
  clientName: string;
  professionalId: string;
  professionalName: string;
  serviceId: string;
  serviceName: string;
  price: string;
  commissionPercentage: string;
}

export interface SettlementAmounts {
  services_total: number;
  professional_total: number;
  business_total: number;
}

export interface SettlementAppointment extends SettlementAmounts {
  appointment_id: string;
  date: Date;
  /** Zona de la cita (6.03): su `date` sale con ese offset. */
  timezone: string;
  client_name: string;
  lines: {
    service_id: string;
    service_name: string;
    price: number;
    commission_percentage: number;
    commission: number;
  }[];
}

export interface SettlementProfessional extends SettlementAmounts {
  professional_id: string;
  professional_name: string;
  appointment_count: number;
  appointments: SettlementAppointment[];
}

export interface CommissionSettlement {
  totals: SettlementAmounts & { appointment_count: number };
  professionals: SettlementProfessional[];
}

const money = (cents: number) => Number(centsToDecimal(cents));

/**
 * Agrupa las líneas por profesional y cita y suma en centavos (sin errores de
 * coma flotante). Profesionales por nombre; citas por fecha.
 */
export function settleCommissions(
  lines: SettlementLine[],
): CommissionSettlement {
  type Acc = { total: number; commission: number };
  const professionals = new Map<
    string,
    {
      name: string;
      acc: Acc;
      appointments: Map<
        string,
        {
          line: SettlementLine;
          acc: Acc;
          items: SettlementAppointment['lines'];
        }
      >;
    }
  >();
  const grand: Acc = { total: 0, commission: 0 };

  for (const line of lines) {
    const priceCents = toCents(line.price);
    const commission = commissionCents(line.price, line.commissionPercentage);
    let pro = professionals.get(line.professionalId);
    if (!pro) {
      pro = {
        name: line.professionalName,
        acc: { total: 0, commission: 0 },
        appointments: new Map(),
      };
      professionals.set(line.professionalId, pro);
    }
    let appt = pro.appointments.get(line.appointmentId);
    if (!appt) {
      appt = { line, acc: { total: 0, commission: 0 }, items: [] };
      pro.appointments.set(line.appointmentId, appt);
    }
    appt.items.push({
      service_id: line.serviceId,
      service_name: line.serviceName,
      price: money(priceCents),
      commission_percentage: Number(line.commissionPercentage),
      commission: money(commission),
    });
    for (const acc of [appt.acc, pro.acc, grand]) {
      acc.total += priceCents;
      acc.commission += commission;
    }
  }

  const amounts = (acc: Acc): SettlementAmounts => ({
    services_total: money(acc.total),
    professional_total: money(acc.commission),
    business_total: money(acc.total - acc.commission),
  });

  const result: SettlementProfessional[] = [...professionals.entries()]
    .map(([id, pro]) => ({
      professional_id: id,
      professional_name: pro.name,
      appointment_count: pro.appointments.size,
      ...amounts(pro.acc),
      appointments: [...pro.appointments.entries()]
        .map(([appointmentId, appt]) => ({
          appointment_id: appointmentId,
          date: appt.line.date,
          timezone: appt.line.timezone,
          client_name: appt.line.clientName,
          ...amounts(appt.acc),
          lines: appt.items,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    }))
    .sort((a, b) => a.professional_name.localeCompare(b.professional_name));

  return {
    totals: {
      ...amounts(grand),
      appointment_count: result.reduce((n, p) => n + p.appointment_count, 0),
    },
    professionals: result,
  };
}
