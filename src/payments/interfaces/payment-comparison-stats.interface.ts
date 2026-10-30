export interface PaymentComparisonStats {
  current_period: {
    start_date: Date;
    end_date: Date;
    total_amount: number;
    payment_count: number;
    average_amount: number;
  };
  previous_period: {
    start_date: Date;
    end_date: Date;
    total_amount: number;
    payment_count: number;
    average_amount: number;
  };
  change: {
    amount_difference: number;
    /** `null` si el periodo anterior es 0 (7.04-8). */
    amount_percentage: number | null;
    count_difference: number;
    /** `null` si el periodo anterior es 0 (7.04-8). */
    count_percentage: number | null;
    average_difference: number;
    /** `null` si el periodo anterior es 0 (7.04-8). */
    average_percentage: number | null;
  };
}
