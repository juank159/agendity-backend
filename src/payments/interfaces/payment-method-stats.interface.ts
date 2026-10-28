/** Un elemento de `GET /payments/stats/by-method` (2.28: incluye los propios). */
export interface PaymentMethodStats {
  /** Código estándar (`CASH`…) o, si es CUSTOM, el nombre del método propio. */
  method: string;
  method_type: 'STANDARD' | 'CUSTOM';
  /** Id del método propio; `null` en los estándar (2.28). */
  custom_payment_method_id: string | null;
  count: number;
  total: number;
  average: number;
  /** Porcentaje del ingreso neto del periodo; la lista suma 100. */
  percentage: number;
}
