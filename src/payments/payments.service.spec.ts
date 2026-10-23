import { NotFoundException } from '@nestjs/common';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
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
  const stored = { existing: null as any, payment: null as any };
  const txPayments = {
    findOne: jest.fn(async (options: any) =>
      options.lock
        ? stored.payment
        : options.where?.status
          ? stored.existing
          : stored.payment,
    ),
    create: jest.fn((p) => p),
    save: jest.fn(async (p) => ({ id: PAYMENT, ...p })),
    update: jest.fn(async () => ({ affected: 1 })),
  };
  const manager = { getRepository: jest.fn(() => txPayments) };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
      work(manager),
    ),
  };
  const paymentRepo = {
    findOne: jest.fn(async () => stored.payment),
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
      PaymentStatus.COMPLETED,
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

  it('ya hay un pago COMPLETED (leído dentro de la transacción): 400 con el texto de siempre', async () => {
    const { service, stored, txPayments } = build();
    stored.existing = { id: 'otro', status: PaymentStatus.COMPLETED };
    const res = await codeOf(service.create(dto(100), TENANT));
    expect(res).toMatchObject({
      status: 400,
      message: 'Ya existe un pago completado para esta cita',
    });
    expect(txPayments.findOne).toHaveBeenCalledWith({
      where: {
        appointment: { id: APPOINTMENT },
        status: PaymentStatus.COMPLETED,
      },
    });
    expect(txPayments.save).not.toHaveBeenCalled();
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

  it('parcial: el pago sigue COMPLETED con refund_amount y la cita no cambia', async () => {
    const { service, stored, txPayments, appointments } = build();
    stored.payment = payment();
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
    expect(appointments.applyPaymentStatus).not.toHaveBeenCalled();
  });

  it('el reembolso que completa el total: pago y cita REFUNDED', async () => {
    const { service, stored, txPayments, appointments } = build();
    stored.payment = payment({ refund_amount: '30.00' });
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
      PaymentStatus.REFUNDED,
    );
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
