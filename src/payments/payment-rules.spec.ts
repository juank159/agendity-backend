import { PaymentStatus } from 'src/common/enums/status.enum';
import {
  applyRefund,
  assertPaymentAmount,
  netAmountSql,
  netPaidCents,
  toCents,
} from './payment-rules';

const completed = (amount: string, refund: string | null = null) => ({
  status: PaymentStatus.COMPLETED,
  amount,
  refund_amount: refund,
});

describe('Reglas de importes de pagos (2.06)', () => {
  it('toCents redondea decimales de Postgres y de coma flotante', () => {
    expect(toCents('100.50')).toBe(10050);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(null)).toBe(0);
  });

  it('monto: > 0 y sin superar el total de la cita', () => {
    expect(() => assertPaymentAmount(0, '50000')).toThrow('mayor que cero');
    expect(() => assertPaymentAmount(-5, '50000')).toThrow('mayor que cero');
    expect(() => assertPaymentAmount(50000.01, '50000.00')).toThrow(
      'superar el total',
    );
    expect(() => assertPaymentAmount(50000, '50000.00')).not.toThrow();
    expect(() => assertPaymentAmount(20000, '50000.00')).not.toThrow(); // anticipo
  });

  it('reembolso parcial: el pago sigue COMPLETED con el acumulado', () => {
    expect(applyRefund(completed('100.00'), 30)).toEqual({
      refundedCents: 3000,
      status: PaymentStatus.COMPLETED,
    });
    expect(applyRefund(completed('100.00', '30.00'), 20.5)).toEqual({
      refundedCents: 5050,
      status: PaymentStatus.COMPLETED,
    });
  });

  it('reembolso que completa el total: REFUNDED', () => {
    expect(applyRefund(completed('100.00', '30.00'), 70).status).toBe(
      PaymentStatus.REFUNDED,
    );
    expect(applyRefund(completed('100.00'), 100).status).toBe(
      PaymentStatus.REFUNDED,
    );
  });

  it('reembolso mayor que el saldo, <= 0 o de un pago no COMPLETED: error', () => {
    expect(() => applyRefund(completed('100.00', '30.00'), 70.01)).toThrow(
      'no puede ser mayor al pago original',
    );
    expect(() => applyRefund(completed('100.00'), 0)).toThrow('mayor que cero');
    expect(() =>
      applyRefund(
        { ...completed('100.00'), status: PaymentStatus.REFUNDED },
        1,
      ),
    ).toThrow('Solo se pueden reembolsar pagos completados');
  });

  it('importe neto (TS y SQL gemelos)', () => {
    expect(netPaidCents(completed('100.00', '30.25'))).toBe(6975);
    expect(netAmountSql('p')).toBe('(p.amount - COALESCE(p.refund_amount, 0))');
  });
});
