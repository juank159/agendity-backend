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
    amount_percentage: number;
    count_difference: number;
    count_percentage: number;
    average_difference: number;
    average_percentage: number;
  };
}
