import { createHash } from 'crypto';
import {
  PaymentAttemptLike,
  WompiEvent,
  WompiTransaction,
  decideAttemptOutcome,
  hasValidWompiChecksum,
  matchesAttemptAmount,
  parseWompiEvent,
  parseWompiTransaction,
  paymentLinkIdFrom,
  wompiEventChecksum,
} from './wompi-event';

const SECRET = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';

/** Evento con la forma de la especificación de Wompi. */
function event(overrides: Partial<WompiEvent> = {}): WompiEvent {
  return {
    event: 'transaction.updated',
    data: {
      transaction: {
        id: '1234-1610641025-49201',
        amount_in_cents: 4490000,
        reference: 'sub_abc',
        customer_email: 'juan@example.com',
        currency: 'COP',
        payment_method_type: 'NEQUI',
        redirect_url: 'https://example.com',
        status: 'APPROVED',
        shipping_address: null,
        payment_link_id: null,
        payment_source_id: null,
      },
    },
    environment: 'prod',
    signature: {
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
      ],
      checksum:
        '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe',
    },
    timestamp: 1530291411,
    sent_at: '2018-07-20T16:45:05.000Z',
    ...overrides,
  };
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('checksum de eventos de Wompi', () => {
  it('vector calculado a mano: propiedades en orden + timestamp + secreto, SHA256 hex', () => {
    // Concatenación escrita a mano, sin pasar por el código:
    const manual =
      '1234-1610641025-49201' + 'APPROVED' + '4490000' + '1530291411' + SECRET;
    expect(sha256(manual)).toBe(
      '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe',
    );
    expect(wompiEventChecksum(event(), SECRET)).toBe(sha256(manual));
    expect(hasValidWompiChecksum(event(), SECRET)).toBe(true);
  });

  it('respeta el orden de signature.properties del cuerpo (no uno fijo)', () => {
    const reordered = event({
      signature: {
        properties: [
          'transaction.amount_in_cents',
          'transaction.status',
          'transaction.id',
        ],
        checksum:
          '66ce2743b4fda052a29da97bb4740d0c3c28f5c39792f26021f08c08ae21b1bb',
      },
    });
    expect(wompiEventChecksum(reordered, SECRET)).toBe(
      sha256('4490000APPROVED1234-1610641025-492011530291411' + SECRET),
    );
    expect(hasValidWompiChecksum(reordered, SECRET)).toBe(true);
    // El checksum del orden original no vale para el orden nuevo.
    expect(
      hasValidWompiChecksum(
        {
          ...reordered,
          signature: {
            ...reordered.signature,
            checksum: event().signature.checksum,
          },
        },
        SECRET,
      ),
    ).toBe(false);
  });

  it('propiedades que Wompi añada (otra ruta, valor numérico o null del cuerpo)', () => {
    const e = event({
      signature: {
        properties: ['transaction.reference', 'transaction.amount_in_cents'],
        checksum: sha256('sub_abc4490000' + '1530291411' + SECRET),
      },
    });
    expect(hasValidWompiChecksum(e, SECRET)).toBe(true);
    // Una propiedad sin valor (null o inexistente) no se puede firmar.
    for (const property of [
      'transaction.payment_link_id',
      'transaction.nope',
    ]) {
      const missing = event({
        signature: {
          properties: [property],
          checksum: sha256('1530291411' + SECRET),
        },
      });
      expect(wompiEventChecksum(missing, SECRET)).toBeNull();
      expect(hasValidWompiChecksum(missing, SECRET)).toBe(false);
    }
  });

  it('acepta el checksum en mayúsculas (hex) y la cabecera X-Event-Checksum igual', () => {
    const e = event();
    const upper = {
      ...e,
      signature: {
        ...e.signature,
        checksum: (e.signature.checksum as string).toUpperCase(),
      },
    };
    expect(hasValidWompiChecksum(upper, SECRET)).toBe(true);
    expect(
      hasValidWompiChecksum(e, SECRET, e.signature.checksum as string),
    ).toBe(true);
    // Solo la cabecera (sin checksum en el cuerpo) también sirve.
    expect(
      hasValidWompiChecksum(
        { ...e, signature: { properties: e.signature.properties } },
        SECRET,
        e.signature.checksum as string,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'firma alterada',
      (e: WompiEvent) => ({
        ...e,
        signature: {
          ...e.signature,
          checksum: 'a' + (e.signature.checksum as string).slice(1),
        },
      }),
    ],
    [
      'timestamp alterado',
      (e: WompiEvent) => ({ ...e, timestamp: 1530291412 }),
    ],
    [
      'estado alterado',
      (e: WompiEvent) => ({
        ...e,
        data: {
          transaction: {
            ...(e.data.transaction as object),
            status: 'DECLINED',
          },
        },
      }),
    ],
    [
      'monto alterado',
      (e: WompiEvent) => ({
        ...e,
        data: {
          transaction: {
            ...(e.data.transaction as object),
            amount_in_cents: 4490001,
          },
        },
      }),
    ],
    [
      'monto como objeto',
      (e: WompiEvent) => ({
        ...e,
        data: {
          transaction: {
            ...(e.data.transaction as object),
            amount_in_cents: { v: 1 },
          },
        },
      }),
    ],
    ['sin signature', (e: WompiEvent) => ({ ...e, signature: undefined })],
    [
      'properties vacío',
      (e: WompiEvent) => ({
        ...e,
        signature: { ...e.signature, properties: [] },
      }),
    ],
    [
      'properties no es lista',
      (e: WompiEvent) => ({
        ...e,
        signature: { ...e.signature, properties: 'transaction.id' },
      }),
    ],
    ['sin timestamp', (e: WompiEvent) => ({ ...e, timestamp: undefined })],
    [
      'timestamp decimal',
      (e: WompiEvent) => ({ ...e, timestamp: 1530291411.5 }),
    ],
    [
      'checksum corto',
      (e: WompiEvent) => ({
        ...e,
        signature: { ...e.signature, checksum: 'abc' },
      }),
    ],
    [
      'checksum no hex',
      (e: WompiEvent) => ({
        ...e,
        signature: { ...e.signature, checksum: 'z'.repeat(64) },
      }),
    ],
  ])('rechaza: %s', (_name, mutate) => {
    expect(hasValidWompiChecksum(mutate(event()), SECRET)).toBe(false);
  });

  it('rechaza con otro secreto, sin secreto o con una cabecera distinta', () => {
    expect(hasValidWompiChecksum(event(), 'otro_secreto')).toBe(false);
    expect(hasValidWompiChecksum(event(), '')).toBe(false);
    expect(hasValidWompiChecksum(event(), SECRET, 'f'.repeat(64))).toBe(false);
  });

  it('timestamp numérico en texto: mismo checksum', () => {
    expect(
      hasValidWompiChecksum(event({ timestamp: '1530291411' }), SECRET),
    ).toBe(true);
  });
});

describe('forma del evento y de la transacción', () => {
  it.each([
    null,
    'x',
    [],
    {},
    { event: 'transaction.updated' },
    { event: '', data: {} },
    { event: 'x', data: [] },
  ])('cuerpo malformado %p → null', (body) => {
    expect(parseWompiEvent(body)).toBeNull();
  });

  it('transacción: toma los campos y el recibo; rechaza la incompleta', () => {
    expect(
      parseWompiTransaction({
        id: 'tx',
        status: 'APPROVED',
        amount_in_cents: 100,
        currency: 'COP',
        reference: 'r',
        payment_link_id: 'link',
        payment_method: { extra: { receipt_url: 'https://r' } },
      }),
    ).toEqual({
      id: 'tx',
      status: 'APPROVED',
      amount_in_cents: 100,
      currency: 'COP',
      reference: 'r',
      payment_link_id: 'link',
      receipt_url: 'https://r',
    });
    const ok = {
      id: 'tx',
      status: 'APPROVED',
      amount_in_cents: 1,
      currency: 'COP',
      reference: 'r',
    };
    for (const broken of [
      { ...ok, id: undefined },
      { ...ok, status: '' },
      { ...ok, amount_in_cents: '100' },
      { ...ok, amount_in_cents: 1.5 },
      { ...ok, currency: undefined },
      { ...ok, reference: undefined },
    ]) {
      expect(parseWompiTransaction(broken)).toBeNull();
    }
  });

  it('id del enlace de pago desde su URL', () => {
    expect(paymentLinkIdFrom('https://checkout.wompi.co/l/test_AbC-12')).toBe(
      'test_AbC-12',
    );
    expect(paymentLinkIdFrom('myapp://payment-demo?reference=x')).toBeNull();
    expect(paymentLinkIdFrom('https://checkout.test/link')).toBeNull();
  });
});

describe('decideAttemptOutcome: idempotencia, importe y estados', () => {
  const tx = (o: Partial<WompiTransaction> = {}): WompiTransaction => ({
    id: 'tx-1',
    status: 'APPROVED',
    amount_in_cents: 14990000,
    currency: 'COP',
    reference: 'sub_s1',
    ...o,
  });
  const attempt = (
    o: Partial<PaymentAttemptLike> = {},
  ): PaymentAttemptLike => ({
    id: 'att-1',
    status: 'pending',
    amount: '149900.00',
    currency: 'COP',
    wompi_transaction_id: null,
    created_at: new Date('2026-10-22T10:00:00Z'),
    ...o,
  });

  it('APPROVED con el importe y la moneda del intento → activar', () => {
    expect(decideAttemptOutcome([attempt()], tx())).toEqual({
      kind: 'activate',
      attempt: attempt(),
    });
  });

  it('el mismo evento otra vez (intento ya pagado con esa transacción) → duplicate', () => {
    const paid = attempt({
      status: 'successful',
      wompi_transaction_id: 'tx-1',
    });
    expect(decideAttemptOutcome([paid], tx()).kind).toBe('duplicate');
  });

  it('rechazo repetido → duplicate; rechazo de una transacción ya pagada → revisar', () => {
    const failed = attempt({ status: 'failed', wompi_transaction_id: 'tx-1' });
    expect(
      decideAttemptOutcome([failed], tx({ status: 'DECLINED' })).kind,
    ).toBe('duplicate');
    const paid = attempt({
      status: 'successful',
      wompi_transaction_id: 'tx-1',
    });
    expect(decideAttemptOutcome([paid], tx({ status: 'VOIDED' })).kind).toBe(
      'paid_then_failed',
    );
  });

  it.each(['DECLINED', 'VOIDED', 'ERROR'])(
    '%s sobre un intento pending → fail',
    (status) => {
      expect(decideAttemptOutcome([attempt()], tx({ status })).kind).toBe(
        'fail',
      );
    },
  );

  it('PENDING y estados desconocidos → nada', () => {
    expect(
      decideAttemptOutcome([attempt()], tx({ status: 'PENDING' })).kind,
    ).toBe('pending');
    expect(decideAttemptOutcome([attempt()], tx({ status: 'RARO' })).kind).toBe(
      'ignored_status',
    );
  });

  it('importe o moneda distintos → amount_mismatch (no activa ni marca fallido)', () => {
    expect(
      decideAttemptOutcome([attempt()], tx({ amount_in_cents: 100 })).kind,
    ).toBe('amount_mismatch');
    expect(
      decideAttemptOutcome([attempt()], tx({ currency: 'USD' })).kind,
    ).toBe('amount_mismatch');
    expect(
      decideAttemptOutcome(
        [attempt()],
        tx({ status: 'DECLINED', amount_in_cents: 100 }),
      ).kind,
    ).toBe('amount_mismatch');
  });

  it('enlace rechazado y luego pagado con otra transacción → activar el intento fallido', () => {
    const failed = attempt({ status: 'failed', wompi_transaction_id: 'tx-0' });
    expect(decideAttemptOutcome([failed], tx())).toMatchObject({
      kind: 'activate',
      attempt: { id: 'att-1' },
    });
  });

  it('varios intentos abiertos con la misma referencia: el que tiene el importe, el más reciente', () => {
    const viejo = attempt({
      id: 'viejo',
      created_at: new Date('2026-10-01T00:00:00Z'),
    });
    const otroPlan = attempt({
      id: 'otro',
      amount: '29900',
      created_at: new Date('2026-10-23T00:00:00Z'),
    });
    const nuevo = attempt({
      id: 'nuevo',
      created_at: new Date('2026-10-22T00:00:00Z'),
    });
    expect(decideAttemptOutcome([viejo, otroPlan, nuevo], tx())).toMatchObject({
      kind: 'activate',
      attempt: { id: 'nuevo' },
    });
  });

  it('otra aprobación sobre un intento ya pagado → already_paid (posible doble cobro)', () => {
    const paid = attempt({
      status: 'successful',
      wompi_transaction_id: 'tx-0',
    });
    expect(decideAttemptOutcome([paid], tx()).kind).toBe('already_paid');
  });

  it('sin intentos → no_attempt', () => {
    expect(decideAttemptOutcome([], tx()).kind).toBe('no_attempt');
  });

  it('importe en centavos: decimal de Postgres frente a amount_in_cents', () => {
    expect(
      matchesAttemptAmount(
        { amount: '149900.00', currency: 'cop' },
        { amount_in_cents: 14990000, currency: 'COP' },
      ),
    ).toBe(true);
    expect(
      matchesAttemptAmount(
        { amount: 149900.01, currency: 'COP' },
        { amount_in_cents: 14990000, currency: 'COP' },
      ),
    ).toBe(false);
  });
});
