export interface PaymentMethodStats {
  method: string;
  method_type: 'STANDARD' | 'CUSTOM'; // Para diferenciar métodos estándar de personalizados
  count: number;
  total: number;
  average: number;
  percentage: number; // Porcentaje del total de ingresos
}
