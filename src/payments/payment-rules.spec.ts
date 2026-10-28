import {
  AppointmentPaymentStatus as A,
  PaymentStatus,
} from 'src/common/enums/status.enum';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  appointmentPaymentStatus,
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

describe('Anticipos: varios pagos hasta el total (2.24)', () => {
  it('monto contra el saldo pendiente (total − lo ya pagado neto)', () => {
    expect(() => assertPaymentAmount(30000, '50000.00', 2000000)).not.toThrow();
    expect(() => assertPaymentAmount(30000.01, '50000.00', 2000000)).toThrow(
      'supera el saldo pendiente de la cita ($30000)',
    );
    // Sin pagos previos, el texto de siempre (lo conoce la app).
    expect(() => assertPaymentAmount(50001, '50000.00', 0)).toThrow(
      'no puede superar el total de la cita',
    );
  });

  it('cita pagada del todo: 409 PAYMENT_ALREADY_EXISTS antes de mirar el monto', () => {
    let error: any;
    try {
      assertPaymentAmount(0, '50000.00', 5000000);
    } catch (e) {
      error = e;
    }
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toMatchObject({
      code: ErrorCode.PAYMENT_ALREADY_EXISTS,
      message: 'La cita ya está pagada por completo',
    });
  });

  it('estado de pago de la cita según lo pagado neto', () => {
    const status = (paidCents: number, hasRefunds = false, total = '100.00') =>
      appointmentPaymentStatus(total, { paidCents, hasRefunds });
    expect(status(0)).toBe(A.PENDING);
    expect(status(1)).toBe(A.PARTIAL);
    expect(status(9999)).toBe(A.PARTIAL);
    expect(status(10000)).toBe(A.COMPLETED);
    // Reembolso de uno de varios pagos: queda lo neto.
    expect(status(5000, true)).toBe(A.PARTIAL);
    expect(status(10000, true)).toBe(A.COMPLETED);
    // Todo devuelto.
    expect(status(0, true)).toBe(A.REFUNDED);
    // Cita de total 0 sin pagos: pendiente (no "pagada").
    expect(status(0, false, '0')).toBe(A.PENDING);
  });
});
