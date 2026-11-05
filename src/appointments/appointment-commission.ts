import { toCents } from 'src/payments/payment-rules';
import {
  AppointmentPaymentStatus,
  AppointmentStatus,
} from 'src/common/enums/status.enum';
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

/**
 * Línea de una cita para la liquidación: COMPLETED (lo ganado) o
 * PENDING/CONFIRMED (lo por ganar, D-27). El estado, el de pago y lo pagado
 * son de la cita (se repiten en cada línea).
 */
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
  status?: AppointmentStatus;
  paymentStatus?: AppointmentPaymentStatus;
  /** Pagado neto de la cita (pagos COMPLETED, `amount − refund_amount`). */
  paidAmount?: string | number;
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
  /** Solo en `pending` (D-27): estado, estado de pago y pagado neto. */
  status?: AppointmentStatus;
  payment_status?: AppointmentPaymentStatus;
  paid_amount?: number;
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

/** Sin la parte del negocio (D-27): lo que recibe el Employee. */
type WithoutBusiness<T> = Omit<T, 'business_total'>;

export type EmployeeSettlementAppointment =
  WithoutBusiness<SettlementAppointment>;

export interface EmployeeSettlementProfessional
  extends WithoutBusiness<Omit<SettlementProfessional, 'appointments'>> {
  appointments: EmployeeSettlementAppointment[];
}

export interface EmployeeCommissionSettlement {
  totals: WithoutBusiness<CommissionSettlement['totals']>;
  professionals: EmployeeSettlementProfessional[];
}

const money = (cents: number) => Number(centsToDecimal(cents));

/**
 * Agrupa las líneas por profesional y cita y suma en centavos (sin errores de
 * coma flotante). Profesionales por nombre; citas por fecha.
 * `withState` (D-27, citas por ganar): cada cita lleva además `status`,
 * `payment_status` y `paid_amount`.
 */
export function settleCommissions(
  lines: SettlementLine[],
  options: { withState?: boolean } = {},
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
          ...(options.withState
            ? {
                status: appt.line.status,
                payment_status: appt.line.paymentStatus,
                paid_amount: money(toCents(appt.line.paidAmount ?? 0)),
              }
            : {}),
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

/**
 * D-27: lo que le queda al negocio no se le envía al Employee. Quita
 * `business_total` (la clave, no la pone a null) de los totales, de cada
 * profesional y de cada cita.
 */
export function withoutBusinessShare(
  settlement: CommissionSettlement,
): EmployeeCommissionSettlement {
  const strip = <T extends SettlementAmounts>(value: T): WithoutBusiness<T> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { business_total, ...rest } = value;
    return rest;
  };
  return {
    totals: strip(settlement.totals),
    professionals: settlement.professionals.map((pro) => ({
      ...strip(pro),
      appointments: pro.appointments.map(strip),
    })),
  };
}
