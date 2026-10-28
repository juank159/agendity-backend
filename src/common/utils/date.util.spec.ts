import { runWithRequestTimeZone } from '../context/request-time-zone';
import {
  parseBusinessRangeEnd,
  addBusinessMonths,
  businessDateKey,
  businessJsonReplacer,
  businessMinutesOfDay,
  defaultBusinessTimeZone,
  DEFAULT_BUSINESS_TIMEZONE,
  endOfBusinessDay,
  formatBusinessLongDate,
  formatBusinessTime,
  isValidDate,
  isValidTimeZone,
  normalizeTimeZone,
  parseBusinessDate,
  startOfBusinessDay,
  toBusinessIso,
  zonedParts,
  zoneOffsetMinutes,
} from './date.util';

const BOGOTA = 'America/Bogota';

// Estos tests no dependen de la zona del proceso: se corren con la zona local
// y con `TZ=UTC` (ver la entrega de 2.05). Todo instante esperado va en UTC (Z).
const iso = (d: Date) => d.toISOString();

describe('date.util (zona del negocio, 2.05)', () => {
  const saved = process.env.BUSINESS_TIMEZONE;
  afterEach(() => {
    if (saved === undefined) delete process.env.BUSINESS_TIMEZONE;
    else process.env.BUSINESS_TIMEZONE = saved;
  });

  describe('defaultBusinessTimeZone (solo negocios nuevos y respaldo, 6.02)', () => {
    it('por defecto es America/Bogota', () => {
      delete process.env.BUSINESS_TIMEZONE;
      expect(DEFAULT_BUSINESS_TIMEZONE).toBe('America/Bogota');
      expect(defaultBusinessTimeZone()).toBe('America/Bogota');
    });

    it('se puede configurar y una zona inválida falla con un mensaje claro', () => {
      process.env.BUSINESS_TIMEZONE = 'Europe/Madrid';
      expect(defaultBusinessTimeZone()).toBe('Europe/Madrid');
      process.env.BUSINESS_TIMEZONE = 'Marte/Olympus';
      expect(() => defaultBusinessTimeZone()).toThrow(
        'BUSINESS_TIMEZONE inválida: "Marte/Olympus"',
      );
    });
  });

  describe('parseBusinessDate', () => {
    it('sin offset (lo que manda hoy la app): hora de Bogotá, no la del servidor', () => {
      expect(iso(parseBusinessDate('2026-10-21T08:00:00.000', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
      expect(iso(parseBusinessDate('2026-10-21T08:00', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
      expect(iso(parseBusinessDate('2026-10-21 08:00:00', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
      // Dart manda microsegundos: se truncan a milisegundos.
      expect(iso(parseBusinessDate('2026-10-21T08:00:00.123456', BOGOTA))).toBe(
        '2026-10-21T13:00:00.123Z',
      );
    });

    it('con offset: se respeta tal cual', () => {
      expect(iso(parseBusinessDate('2026-10-21T13:00:00.000Z', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
      expect(iso(parseBusinessDate('2026-10-21T08:00:00-05:00', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
      expect(
        iso(parseBusinessDate('2026-10-21T15:00:00.000+0200', BOGOTA)),
      ).toBe('2026-10-21T13:00:00.000Z');
      expect(iso(parseBusinessDate('2026-10-21T13:00:00+00', BOGOTA))).toBe(
        '2026-10-21T13:00:00.000Z',
      );
    });

    it('solo fecha: 00:00 de ese día en Bogotá (05:00 UTC), no medianoche UTC', () => {
      expect(iso(parseBusinessDate('2026-10-21', BOGOTA))).toBe(
        '2026-10-21T05:00:00.000Z',
      );
    });

    it('un Date se devuelve igual; formatos raros o fechas imposibles → Invalid Date', () => {
      const d = new Date('2026-10-21T13:00:00Z');
      expect(parseBusinessDate(d, BOGOTA)).toBe(d);
      for (const bad of [
        '',
        'mañana',
        '21/10/2026',
        '2026-02-30',
        '2026-13-01T08:00',
        '2026-10-21T25:00',
        '2026-10-21T08:61',
        '2026-10-21T08:00:00+25:00',
        'Tue Oct 21 2026',
      ]) {
        expect(isValidDate(parseBusinessDate(bad, BOGOTA))).toBe(false);
      }
      expect(isValidDate(parseBusinessDate('2028-02-29', BOGOTA))).toBe(true);
    });

    it('acepta otra zona del negocio (y su horario de verano)', () => {
      // Madrid: +02:00 en verano, +01:00 en invierno.
      expect(
        iso(parseBusinessDate('2026-07-01T10:00:00', 'Europe/Madrid')),
      ).toBe('2026-07-01T08:00:00.000Z');
      expect(
        iso(parseBusinessDate('2026-12-01T10:00:00', 'Europe/Madrid')),
      ).toBe('2026-12-01T09:00:00.000Z');
    });
  });

  describe('salida y partes en la zona del negocio', () => {
    it('toBusinessIso: ISO con el offset de Bogotá', () => {
      expect(toBusinessIso(new Date('2026-10-21T13:00:00Z'), BOGOTA)).toBe(
        '2026-10-21T08:00:00.000-05:00',
      );
      expect(zoneOffsetMinutes(new Date('2026-10-21T13:00:00Z'), BOGOTA)).toBe(
        -300,
      );
      expect(
        toBusinessIso(new Date('2026-07-01T08:00:00.5Z'), 'Europe/Madrid'),
      ).toBe('2026-07-01T10:00:00.500+02:00');
      expect(toBusinessIso(new Date('2026-10-21T13:00:00Z'), 'UTC')).toBe(
        '2026-10-21T13:00:00.000+00:00',
      );
    });

    it('toBusinessIso y parseBusinessDate son inversas', () => {
      const d = new Date('2026-03-08T07:30:15.250Z');
      expect(
        parseBusinessDate(toBusinessIso(d, BOGOTA), BOGOTA).getTime(),
      ).toBe(d.getTime());
    });

    it('cambio de día: las 21:00 en Bogotá ya son el día siguiente en UTC', () => {
      const night = parseBusinessDate('2026-10-21T21:00:00', BOGOTA);
      expect(iso(night)).toBe('2026-10-22T02:00:00.000Z');
      expect(businessDateKey(night, BOGOTA)).toBe('2026-10-21');
      expect(zonedParts(night, BOGOTA)).toMatchObject({
        year: 2026,
        month: 10,
        day: 21,
        hour: 21,
        weekday: 3, // miércoles
      });
    });

    it('medianoche en Bogotá frente a medianoche UTC', () => {
      const utcMidnight = new Date('2026-10-22T00:00:00Z');
      // 00:00 UTC del 22 = 19:00 del 21 en Bogotá
      expect(businessDateKey(utcMidnight, BOGOTA)).toBe('2026-10-21');
      expect(iso(startOfBusinessDay(utcMidnight, BOGOTA))).toBe(
        '2026-10-21T05:00:00.000Z',
      );
      expect(iso(endOfBusinessDay(utcMidnight, BOGOTA))).toBe(
        '2026-10-22T04:59:59.999Z',
      );
      // 00:30 en Bogotá del 22 = 05:30 UTC del 22
      const justAfter = parseBusinessDate('2026-10-22T00:30:00', BOGOTA);
      expect(businessDateKey(justAfter, BOGOTA)).toBe('2026-10-22');
      expect(iso(startOfBusinessDay(justAfter, BOGOTA))).toBe(
        '2026-10-22T05:00:00.000Z',
      );
      expect(businessMinutesOfDay(justAfter, BOGOTA)).toBe(30);
    });

    it('fin de mes y de año en Bogotá', () => {
      const newYearsEve = parseBusinessDate('2026-12-31T22:00:00', BOGOTA);
      expect(businessDateKey(newYearsEve, BOGOTA)).toBe('2026-12-31');
      expect(iso(endOfBusinessDay(newYearsEve, BOGOTA))).toBe(
        '2027-01-01T04:59:59.999Z',
      );
    });
  });

  describe('addBusinessMonths', () => {
    const bogota = (wall: string) => new Date(`${wall}-05:00`);

    it('suma meses sin desbordar el fin de mes y conserva la hora', () => {
      expect(
        addBusinessMonths(bogota('2026-01-31T00:00:00'), 1, BOGOTA),
      ).toEqual(bogota('2026-02-28T00:00:00'));
      expect(
        addBusinessMonths(bogota('2028-01-31T00:00:00'), 1, BOGOTA),
      ).toEqual(bogota('2028-02-29T00:00:00'));
      expect(
        addBusinessMonths(bogota('2026-08-31T10:30:00'), 6, BOGOTA),
      ).toEqual(bogota('2027-02-28T10:30:00'));
      expect(
        addBusinessMonths(bogota('2026-05-15T00:00:00'), 12, BOGOTA),
      ).toEqual(bogota('2027-05-15T00:00:00'));
    });

    it('usa el calendario de Bogotá aunque en UTC ya sea otro día', () => {
      // 30 de enero 21:00 en Bogotá = 31 de enero 02:00 UTC
      expect(
        addBusinessMonths(bogota('2026-01-30T21:00:00'), 1, BOGOTA),
      ).toEqual(bogota('2026-02-28T21:00:00'));
    });
  });

  describe('textos', () => {
    it('fecha larga y hora en la zona del negocio', () => {
      const d = new Date('2026-10-21T13:00:00Z');
      expect(formatBusinessLongDate(d, BOGOTA)).toBe('miércoles 21 de octubre');
      expect(formatBusinessTime(d, BOGOTA)).toBe('8:00 AM');
      expect(formatBusinessTime(new Date('2026-10-21T05:05:00Z'), BOGOTA)).toBe(
        '12:05 AM',
      );
      expect(formatBusinessTime(new Date('2026-10-21T20:30:00Z'), BOGOTA)).toBe(
        '3:30 PM',
      );
    });
  });

  describe('businessJsonReplacer (respuestas HTTP)', () => {
    it('todo Date sale con el offset de la zona del tenant de la petición; el resto no cambia', () => {
      const body = {
        date: new Date('2026-10-21T13:00:00Z'),
        nested: [{ created_at: new Date('2026-10-22T02:00:00Z') }],
        invalid: new Date(NaN),
        text: '2026-10-21',
        n: 1,
        empty: null,
      };
      const json = (timeZone: string | undefined) =>
        JSON.parse(
          runWithRequestTimeZone(timeZone, () =>
            JSON.stringify(body, businessJsonReplacer),
          ),
        );
      const rest = { invalid: null, text: '2026-10-21', n: 1, empty: null };
      // Con la zona del tenant de la petición (6.02): su offset.
      expect(json('America/Bogota')).toEqual({
        date: '2026-10-21T08:00:00.000-05:00',
        nested: [{ created_at: '2026-10-21T21:00:00.000-05:00' }],
        ...rest,
      });
      expect(json('America/Caracas')).toEqual({
        date: '2026-10-21T09:00:00.000-04:00',
        nested: [{ created_at: '2026-10-21T22:00:00.000-04:00' }],
        ...rest,
      });
      // Sin tenant (rutas públicas o fuera de una petición): UTC.
      expect(json(undefined)).toEqual({
        date: '2026-10-21T13:00:00.000Z',
        nested: [{ created_at: '2026-10-22T02:00:00.000Z' }],
        ...rest,
      });
      expect(JSON.parse(JSON.stringify(body, businessJsonReplacer))).toEqual(
        json(undefined),
      );
    });
  });
});

describe('parseBusinessRangeEnd (fin exclusivo de un rango, 2.34)', () => {
  const TZ = 'America/Bogota';
  it('solo fecha: 00:00 del día siguiente del negocio (incluye el día)', () => {
    expect(parseBusinessRangeEnd('2026-10-21', TZ).toISOString()).toBe(
      '2026-10-22T05:00:00.000Z',
    );
    expect(parseBusinessRangeEnd('2026-12-31', TZ).toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });
  it('instante con o sin offset: tal cual', () => {
    expect(
      parseBusinessRangeEnd('2026-10-21T08:00:00-05:00', TZ).toISOString(),
    ).toBe('2026-10-21T13:00:00.000Z');
    expect(parseBusinessRangeEnd('2026-10-21T08:00', TZ).toISOString()).toBe(
      '2026-10-21T13:00:00.000Z',
    );
  });
  it('inválida: Invalid Date', () => {
    expect(Number.isNaN(parseBusinessRangeEnd('nada', TZ).getTime())).toBe(
      true,
    );
    expect(
      Number.isNaN(parseBusinessRangeEnd('2026-02-31', TZ).getTime()),
    ).toBe(true);
  });
});

describe('normalizeTimeZone / isValidTimeZone (zona por tenant, 6.01)', () => {
  it.each([
    ['America/Bogota', 'America/Bogota'],
    ['America/Caracas', 'America/Caracas'],
    ['Europe/Madrid', 'Europe/Madrid'],
    ['  america/bogota ', 'America/Bogota'],
    ['UTC', 'UTC'],
    ['Etc/UTC', 'UTC'],
  ])('%p → %p', (input, canonical) => {
    expect(normalizeTimeZone(input)).toBe(canonical);
    expect(isValidTimeZone(input)).toBe(true);
  });

  it.each([
    ['Mars/Phobos'],
    ['Bogota'],
    ['-05:00'],
    ['+0300'],
    [''],
    ['America/New York'],
    ['../etc/passwd'],
    ['x'.repeat(65)],
    [undefined],
    [null],
    [-5],
    [{}],
  ])('%p no es una zona IANA', (input) => {
    expect(normalizeTimeZone(input)).toBeNull();
    expect(isValidTimeZone(input)).toBe(false);
  });
});
