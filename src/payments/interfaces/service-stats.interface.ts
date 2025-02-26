export interface ServiceStats {
  service_id: string;
  service_name: string;
  payment_count: number;
  total_amount: number;
  average_amount: number;
  percentage_of_total: number; // Porcentaje de la facturación total
}
