import { AppointmentStatus as S } from 'src/common/enums/status.enum';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  APPOINTMENT_TRANSITIONS,
  assertTransition,
  canTransition,
  isFinalStatus,
  statusAfterPayment,
} from './appointment-status';

const ALL = Object.values(S);
const ALLOWED: [S, S][] = [
  [S.PENDING, S.CONFIRMED],
  [S.PENDING, S.CANCELLED],
  [S.CONFIRMED, S.COMPLETED],
  [S.CONFIRMED, S.CANCELLED],
];
const isAllowed = (from: S, to: S) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

describe('Máquina de estados de la cita (2.06)', () => {
  it('cubre los 4 estados del enum', () => {
    expect(Object.keys(APPOINTMENT_TRANSITIONS).sort()).toEqual(
      [...ALL].sort(),
    );
  });

  // Las 16 combinaciones: 4 válidas, 4 "mismo estado" (no-op) y 8 inválidas.
  for (const from of ALL) {
    for (const to of ALL) {
      const kind =
        from === to ? 'no-op' : isAllowed(from, to) ? 'válida' : 'inválida';
      it(`${from} → ${to}: ${kind}`, () => {
        expect(canTransition(from, to)).toBe(kind === 'válida');
        if (kind === 'inválida') {
          let error: any;
          try {
            assertTransition(from, to);
          } catch (e) {
            error = e;
          }
          expect(error?.getStatus()).toBe(409);
          expect(error.getResponse()).toMatchObject({
            code: ErrorCode.INVALID_STATE_TRANSITION,
          });
          expect(typeof error.getResponse().message).toBe('string');
        } else {
          expect(assertTransition(from, to)).toBe(kind === 'válida');
        }
      });
    }
  }

  it('COMPLETED y CANCELLED son finales', () => {
    expect(ALL.filter(isFinalStatus).sort()).toEqual(
      [S.CANCELLED, S.COMPLETED].sort(),
    );
  });

  it('pago: PENDING → CONFIRMED; CONFIRMED y COMPLETED se quedan; CANCELLED → 409', () => {
    expect(statusAfterPayment(S.PENDING)).toBe(S.CONFIRMED);
    expect(statusAfterPayment(S.CONFIRMED)).toBe(S.CONFIRMED);
    expect(statusAfterPayment(S.COMPLETED)).toBe(S.COMPLETED);
    expect(() => statusAfterPayment(S.CANCELLED)).toThrow(
      'No se puede registrar un pago en una cita cancelada',
    );
  });
});
