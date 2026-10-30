// Tests de la lógica de la página de reservas (9.02), sin dependencias:
// `node --test test/web/` (script `npm run test:web`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrid,
  dayKey,
  errorMessage,
  formatCOP,
  formatDuration,
  formatTime,
  isClosedDay,
  isoWeekday,
  nextDays,
  wallToInstant,
} from '../../public/reservar/booking-core.mjs';

const BOGOTA = 'America/Bogota';
const CARACAS = 'America/Caracas';
const MADRID = 'Europe/Madrid';

test('la hora de pared de cada zona, sin importar la del navegador', () => {
  assert.equal(
    wallToInstant('2031-03-03', 9 * 60, BOGOTA).toISOString(),
    '2031-03-03T14:00:00.000Z',
  );
  assert.equal(
    wallToInstant('2031-03-03', 9 * 60, CARACAS).toISOString(),
    '2031-03-03T13:00:00.000Z',
  );
  // Madrid en verano (+02:00) y en invierno (+01:00).
  assert.equal(
    wallToInstant('2031-07-01', 10 * 60, MADRID).toISOString(),
    '2031-07-01T08:00:00.000Z',
  );
  assert.equal(
    wallToInstant('2031-12-01', 10 * 60, MADRID).toISOString(),
    '2031-12-01T09:00:00.000Z',
  );
  // 02:00Z del 4 = 21:00 del 3 en Bogotá.
  assert.equal(dayKey(new Date('2031-03-04T02:00:00Z'), BOGOTA), '2031-03-03');
});

test('carrusel: 14 días desde hoy en la zona del negocio; cerrados según el horario', () => {
  const now = new Date('2031-03-04T03:00:00Z'); // 22:00 del 3 en Bogotá
  const days = nextDays(now, BOGOTA, 14);
  assert.equal(days.length, 14);
  assert.equal(days[0], '2031-03-03');
  assert.equal(days[13], '2031-03-16');
  assert.equal(isoWeekday('2031-03-03'), 1); // lunes
  const weekdays = [1, 2, 3, 4, 5].map((d) => ({
    day_of_week: d,
    start_time: '09:00',
    end_time: '18:00',
  }));
  assert.equal(isClosedDay(weekdays, '2031-03-08'), true); // sábado
  assert.equal(isClosedDay(weekdays, '2031-03-03'), false);
  assert.equal(isClosedDay(null, '2031-03-08'), false); // sin horario = abierto
});

test('rejilla: inicios dentro del horario donde cabe la duración; libres = slots; el resto ocupado', () => {
  const hours = [
    { day_of_week: 1, start_time: '09:00', end_time: '12:00' },
    { day_of_week: 1, start_time: '14:00', end_time: '16:00' },
  ];
  const slot = (hhmm) => wallToInstant('2031-03-03', toMin(hhmm), BOGOTA);
  const blocks = buildGrid({
    ymd: '2031-03-03',
    timeZone: BOGOTA,
    openingHours: hours,
    step: 60,
    durationMinutes: 60,
    slots: [slot('09:00'), slot('11:00'), slot('15:00')].map((d) =>
      d.toISOString(),
    ),
    now: new Date('2031-03-01T00:00:00Z'),
  });
  assert.deepEqual(
    blocks.map((b) => `${b.label} ${b.available ? 'libre' : 'ocupado'}`),
    [
      '09:00 libre',
      '10:00 ocupado',
      '11:00 libre',
      '14:00 ocupado',
      '15:00 libre',
    ],
  );
});

test('rejilla: alineada a las 00:00 (como el servidor), sin horas pasadas y en la zona del negocio', () => {
  const hours = [{ day_of_week: 1, start_time: '09:30', end_time: '12:00' }];
  const blocks = buildGrid({
    ymd: '2031-03-03',
    timeZone: CARACAS,
    openingHours: hours,
    step: 60,
    durationMinutes: 30,
    slots: [],
    // 10:30 en Caracas: las 10:00 ya pasaron.
    now: new Date('2031-03-03T14:30:00Z'),
  });
  assert.deepEqual(
    blocks.map((b) => b.label),
    ['11:00'],
  );
  assert.equal(blocks[0].start.toISOString(), '2031-03-03T15:00:00.000Z');
});

test('rejilla sin horario del negocio: de la primera a la última hora libre', () => {
  const slots = ['10:00', '12:00'].map((h) =>
    wallToInstant('2031-03-03', toMin(h), BOGOTA).toISOString(),
  );
  const blocks = buildGrid({
    ymd: '2031-03-03',
    timeZone: BOGOTA,
    openingHours: null,
    step: 60,
    durationMinutes: 60,
    slots,
    now: new Date('2031-03-01T00:00:00Z'),
  });
  assert.deepEqual(
    blocks.map((b) => `${b.label} ${b.available}`),
    ['10:00 true', '11:00 false', '12:00 true'],
  );
});

test('formatos en español y pesos colombianos; mensajes humanos por código', () => {
  assert.match(formatCOP(30000), /30\.000/);
  assert.equal(formatDuration(90), '1 h 30 min');
  assert.equal(formatDuration(45), '45 min');
  assert.match(formatTime('2031-03-03T14:00:00Z', BOGOTA), /^9:00/);
  assert.match(formatTime('2031-03-03T14:00:00Z', CARACAS), /^10:00/);
  assert.equal(errorMessage({ status: 404 }), 'Este link no existe.');
  assert.match(errorMessage({ status: 429 }), /demasiados intentos/);
  assert.match(errorMessage({ code: 'SLOT_UNAVAILABLE' }), /acaba de ocuparse/);
  assert.match(
    errorMessage({ code: 'ONLINE_BOOKING_UNAVAILABLE' }),
    /no está recibiendo reservas/,
  );
  assert.equal(
    errorMessage({ code: 'BOOKING_LIMIT_REACHED', message: 'Ya tienes 3' }),
    'Ya tienes 3',
  );
});

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
