/** Un elemento de `GET /payments/stats/by-service` (2.28: ingreso neto real). */
export interface ServiceStats {
  service_id: string;
  service_name: string;
  /** Citas con pagos en el periodo que incluyen el servicio (2.28). */
  appointment_count: number;
  /** Pagos de esas citas en el periodo (una cita puede tener varios). */
  payment_count: number;
  /** Ingreso neto atribuido al servicio (reparto por precio dentro de la cita). */
  total_amount: number;
  /** `total_amount / appointment_count` (2.28: antes, el precio de lista). */
  average_amount: number;
  /** Porcentaje del ingreso neto del periodo; la lista suma 100. */
  percentage_of_total: number;
}

/** Fila de `PaymentsService.serviceRevenue`. */
export interface ServiceRevenueRow {
  service_id: string;
  service_name: string;
  appointment_count: number;
  payment_count: number;
  total_amount: number;
}
