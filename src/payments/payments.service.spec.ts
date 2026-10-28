import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  AppointmentPaymentStatus,
  AppointmentStatus,
  PaymentMethod,
  PaymentStatus,
} from 'src/common/enums/status.enum';
import { PaymentsService } from './payments.service';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const APPOINTMENT = 'a0000000-0000-4000-8000-000000000001';
const PAYMENT = 'p0000000-0000-4000-8000-000000000001';

function build(appointment: Record<string, any> | null = {}) {
  const row =
    appointment &&
    ({
      id: APPOINTMENT,
      ownerId: TENANT,
      status: AppointmentStatus.PENDING,
      payment_status: AppointmentPaymentStatus.PENDING,
      total_price: '50000',
      client: { id: 'cliente' },
      ...appointment,
    } as any);
  const appointments = {
    findOne: jest.fn(async (id: string, tenant: string) => {
      if (!row || tenant !== TENANT) {
        throw new NotFoundException(`Cita con ID ${id} no encontrada`);
      }
      return row;
    }),
    lockAppointment: jest.fn(async () => row),
    applyPaymentStatus: jest.fn(async () => undefined),
  };
  // `paid`/`hasRefunds` = lo que devuelve la suma de pagos de la cita (2.24).
  const stored = {
    payment: null as any,
    paid: '0',
    hasRefunds: false,
  };
  const txPayments = {
    findOne: jest.fn<Promise<any>, [any?]>(async () => stored.payment),
    create: jest.fn((p) => p),
    save: jest.fn(async (p) => ({ id: PAYMENT, ...p })),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const manager = {
    getRepository: jest.fn(() => txPayments),
    query: jest.fn<Promise<any[]>, [string, unknown[]?]>(async (sql) => {
      if (!sql.includes('FROM payments')) throw new Error(`SQL: ${sql}`);
      return [{ paid: stored.paid, has_refunds: stored.hasRefunds }];
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
      work(manager),
    ),
  };
  const paymentRepo = {
    findOne: jest.fn<Promise<any>, [any?]>(async () => stored.payment),
    save: jest.fn(),
  };
  const notifications = { create: jest.fn(async () => ({})) };
  const customMethods = { findOne: jest.fn(async () => ({})) };
  const service = new PaymentsService(
    paymentRepo as any,
    appointments as any,
    notifications as any,
    customMethods as any,
    dataSource as any,
  );
  return {
    service,
    appointments,
    txPayments,
    paymentRepo,
    notifications,
    dataSource,
    stored,
    manager,
  };
}

const dto = (amount: number) =>
  ({
    appointment_id: APPOINTMENT,
    amount,
    payment_method: PaymentMethod.CASH,
  }) as any;

async function codeOf(promise: Promise<unknown>) {
  const error: any = await promise.catch((e) => e);
  return { status: error?.getStatus?.(), ...error?.getResponse?.() };
}

describe('PaymentsService.create (2.06)', () => {
  it('registra el pago en la transacción, con la cita bloqueada, y la confirma', async () => {
    const { service, appointments, txPayments, dataSource, notifications } =
      build();
    await service.create(dto(50000), TENANT);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(appointments.lockAppointment).toHaveBeenCalledWith(
      expect.anything(),
      APPOINTMENT,
      TENANT,
    );
    expect(txPayments.save).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 50000,
        status: PaymentStatus.COMPLETED,
        ownerId: TENANT,
      }),
    );
    expect(appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: APPOINTMENT }),
      AppointmentPaymentStatus.COMPLETED,
      true,
    );
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('monto 0, negativo o mayor que el total: 400 sin guardar', async () => {
    for (const amount of [0, -1, 50000.01]) {
      const { service, txPayments } = build();
      const res = await codeOf(service.create(dto(amount), TENANT));
      expect(res).toMatchObject({ status: 400, code: ErrorCode.BAD_REQUEST });
      expect(txPayments.save).not.toHaveBeenCalled();
    }
  });

  it('cita cancelada: 409 INVALID_STATE_TRANSITION sin guardar', async () => {
    const { service, txPayments, notifications } = build({
      status: AppointmentStatus.CANCELLED,
    });
    const res = await codeOf(service.create(dto(100), TENANT));
    expect(res).toMatchObject({
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(txPayments.save).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('cita de otro negocio: 404 sin abrir la transacción', async () => {
    const { service, dataSource, txPayments } = build();
    const error = await service
      .create(dto(100), '99999999-9999-4999-8999-999999999999')
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(txPayments.save).not.toHaveBeenCalled();
  });

  it('cita pagada del todo (suma leída bajo el lock): 409 PAYMENT_ALREADY_EXISTS', async () => {
    const { service, stored, txPayments, manager, appointments } = build();
    stored.paid = '50000.00';
    const res = await codeOf(service.create(dto(100), TENANT));
    expect(res).toMatchObject({
      status: 409,
      code: 'PAYMENT_ALREADY_EXISTS',
      message: 'La cita ya está pagada por completo',
    });
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain("status = 'COMPLETED'");
    expect(params).toEqual([APPOINTMENT]);
    expect(
      appointments.lockAppointment.mock.invocationCallOrder[0],
    ).toBeLessThan(manager.query.mock.invocationCallOrder[0]);
    expect(txPayments.save).not.toHaveBeenCalled();
  });

  it('anticipo: el primer pago parcial confirma la cita y la deja PARTIAL (2.24)', async () => {
    const { service, appointments } = build();
    await service.create(dto(20000), TENANT);
    expect(appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: APPOINTMENT }),
      AppointmentPaymentStatus.PARTIAL,
      true,
    );
  });

  it('segundo pago: hasta el saldo pendiente; el que completa el total la deja COMPLETED (2.24)', async () => {
    const over = build();
    over.stored.paid = '30000.00';
    const res = await codeOf(over.service.create(dto(20000.01), TENANT));
    expect(res).toMatchObject({ status: 400, code: ErrorCode.BAD_REQUEST });
    expect(res.message).toContain('saldo pendiente');
    expect(over.txPayments.save).not.toHaveBeenCalled();

    const ok = build();
    ok.stored.paid = '30000.00';
    await ok.service.create(dto(20000), TENANT);
    expect(ok.txPayments.save).toHaveBeenCalledTimes(1);
    expect(ok.appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      AppointmentPaymentStatus.COMPLETED,
      true,
    );
  });

  it('un fallo de la notificación no convierte el pago guardado en error', async () => {
    const { service, notifications } = build();
    notifications.create.mockRejectedValueOnce(new Error('smtp'));
    await expect(service.create(dto(100), TENANT)).resolves.toBeDefined();
  });
});

describe('PaymentsService.refund (2.06)', () => {
  const payment = (extra: Record<string, any> = {}) => ({
    id: PAYMENT,
    ownerId: TENANT,
    amount: '100.00',
    refund_amount: null,
    status: PaymentStatus.COMPLETED,
    appointment: { id: APPOINTMENT, client: { id: 'cliente' } },
    ...extra,
  });

  it('parcial: el pago sigue COMPLETED con refund_amount y la cita pasa a PARTIAL (2.24)', async () => {
    const { service, stored, txPayments, appointments, manager } = build({
      total_price: '100',
      payment_status: AppointmentPaymentStatus.COMPLETED,
    });
    stored.payment = payment();
    stored.paid = '70.00'; // lo pagado neto tras el reembolso
    stored.hasRefunds = true;
    await service.refund(
      PAYMENT,
      { refund_amount: 30, refund_reason: 'parcial' },
      TENANT,
    );
    expect(appointments.lockAppointment).toHaveBeenCalledWith(
      expect.anything(),
      APPOINTMENT,
      TENANT,
    );
    expect(txPayments.findOne.mock.calls[0][0]).toMatchObject({
      where: { id: PAYMENT, ownerId: TENANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(txPayments.update).toHaveBeenCalledWith(
      { id: PAYMENT },
      {
        status: PaymentStatus.COMPLETED,
        refund_amount: 30,
        refund_reason: 'parcial',
      },
    );
    // La suma se lee DESPUÉS de escribir el reembolso (misma transacción).
    expect(txPayments.update.mock.invocationCallOrder[0]).toBeLessThan(
      manager.query.mock.invocationCallOrder[0],
    );
    expect(appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: APPOINTMENT }),
      AppointmentPaymentStatus.PARTIAL,
      false,
    );
  });

  it('el reembolso que completa el total: pago y cita REFUNDED', async () => {
    const { service, stored, txPayments, appointments } = build({
      total_price: '100',
      payment_status: AppointmentPaymentStatus.PARTIAL,
    });
    stored.payment = payment({ refund_amount: '30.00' });
    stored.paid = '0';
    stored.hasRefunds = true;
    await service.refund(
      PAYMENT,
      { refund_amount: 70, refund_reason: 'resto' },
      TENANT,
    );
    expect(txPayments.update).toHaveBeenCalledWith(
      { id: PAYMENT },
      {
        status: PaymentStatus.REFUNDED,
        refund_amount: 100,
        refund_reason: 'resto',
      },
    );
    expect(appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: APPOINTMENT }),
      AppointmentPaymentStatus.REFUNDED,
      false,
    );
  });

  it('reembolsar del todo uno de dos pagos: la cita queda PARTIAL con lo que sigue pagado (2.24)', async () => {
    const { service, stored, appointments } = build({
      total_price: '200',
      payment_status: AppointmentPaymentStatus.COMPLETED,
    });
    stored.payment = payment();
    stored.paid = '100.00'; // el otro pago sigue entero
    stored.hasRefunds = true;
    await service.refund(
      PAYMENT,
      { refund_amount: 100, refund_reason: 'uno' },
      TENANT,
    );
    expect(appointments.applyPaymentStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      AppointmentPaymentStatus.PARTIAL,
      false,
    );
  });

  it('si el estado de pago de la cita no cambia, no la toca', async () => {
    const { service, stored, appointments } = build({
      total_price: '100',
      payment_status: AppointmentPaymentStatus.PARTIAL,
    });
    stored.payment = payment({ amount: '50.00' });
    stored.paid = '40.00';
    stored.hasRefunds = true;
    await service.refund(
      PAYMENT,
      { refund_amount: 10, refund_reason: 'x' },
      TENANT,
    );
    expect(appointments.applyPaymentStatus).not.toHaveBeenCalled();
  });

  it('más que el saldo o un pago ya REFUNDED: 400 sin escribir', async () => {
    for (const p of [
      payment({ refund_amount: '30.00' }),
      payment({ status: PaymentStatus.REFUNDED }),
    ]) {
      const { service, stored, txPayments } = build();
      stored.payment = p;
      const res = await codeOf(
        service.refund(
          PAYMENT,
          { refund_amount: 70.01, refund_reason: 'x' },
          TENANT,
        ),
      );
      expect(res.status).toBe(400);
      expect(txPayments.update).not.toHaveBeenCalled();
    }
  });

  it('pago de otro negocio: 404', async () => {
    const { service } = build();
    const error = await service
      .refund(PAYMENT, { refund_amount: 1, refund_reason: 'x' }, TENANT)
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundException);
  });
});

describe('PaymentsService (estadísticas, 2.28)', () => {
  const day = new Date('2030-01-07T00:00:00-05:00');
  const withRows = (rows: any[]) => {
    const built = build();
    (built.paymentRepo as any).manager = {
      query: jest.fn<Promise<any[]>, [string, unknown[]]>(async () => rows),
    };
    return built;
  };

  it('by-service: porcentajes sobre lo atribuido (suman 100) y promedio por cita', async () => {
    const { service, paymentRepo } = withRows([
      {
        service_id: 'a',
        service_name: 'A',
        appointment_count: '2',
        payment_count: '3',
        total_amount: '75.004',
      },
      {
        service_id: 'b',
        service_name: 'B',
        appointment_count: '1',
        payment_count: '1',
        total_amount: '25',
      },
    ]);
    const rows = await service.getPaymentStatsByService(day, day, TENANT);
    expect(rows).toEqual([
      {
        service_id: 'a',
        service_name: 'A',
        appointment_count: 2,
        payment_count: 3,
        total_amount: 75,
        average_amount: 37.5,
        percentage_of_total: 75,
      },
      expect.objectContaining({ service_id: 'b', percentage_of_total: 25 }),
    ]);
    const [sql, params] = (paymentRepo as any).manager.query.mock.calls[0];
    expect(sql).toContain('l.price / l.appointment_price');
    expect(params).toHaveLength(3); // sin filtro de profesional
  });

  it('by-method: estándar y propios en la misma lista; porcentajes suman 100', async () => {
    const { service } = withRows([
      {
        method: 'CASH',
        method_type: 'STANDARD',
        custom_payment_method_id: null,
        count: '2',
        total: '60',
      },
      {
        method: 'Nequi',
        method_type: 'CUSTOM',
        custom_payment_method_id: 'm1',
        count: '1',
        total: '40',
      },
    ]);
    const rows = await service.getPaymentStatsByMethod(day, day, TENANT);
    expect(rows).toEqual([
      {
        method: 'CASH',
        method_type: 'STANDARD',
        custom_payment_method_id: null,
        count: 2,
        total: 60,
        average: 30,
        percentage: 60,
      },
      {
        method: 'Nequi',
        method_type: 'CUSTOM',
        custom_payment_method_id: 'm1',
        count: 1,
        total: 40,
        average: 40,
        percentage: 40,
      },
    ]);
  });
});
