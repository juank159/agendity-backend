export interface ClientStats {
  client_id: string;
  client_name: string;
  first_visit_date: Date;
  last_visit_date: Date;
  visit_count: number;
  payment_count: number;
  total_spent: number;
  average_per_payment: number;
  frequency_days: number;
}
