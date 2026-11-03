import { firstFreeSlug, slugify } from './business-slug';
import {
  fitsOpeningHours,
  openingHoursDaySpans,
  openingHoursError,
  openingHoursWindows,
  sortOpeningHours,
} from './opening-hours';
import { dayWindows } from 'src/appointments/appointment-slot';
import { AppointmentSource } from 'src/common/enums/status.enum';

const { APP, WEB } = AppointmentSource;

describe('slug del negocio (8.00)', () => {
  it('minúsculas, sin tildes ni símbolos, con guiones', () => {
    expect(slugify('Estudio Cejas & Pestañas')).toBe('estudio-cejas-pestanas');
    expect(slugify('  Barbería   Él  ')).toBe('barberia-el');
    expect(slugify('&&&')).toBe('');
    expect(slugify('x'.repeat(100))).toHaveLength(60);
  });

  it('primer slug libre con sufijo', () => {
    expect(firstFreeSlug('salon', [])).toBe('salon');
    expect(firstFreeSlug('salon', ['salon', 'salon-2'])).toBe('salon-3');
  });
});

describe('horario del negocio (8.01)', () => {
  const BOGOTA = 'America/Bogota';
  // Lunes 2030-01-07 en Bogotá.
  const at = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00-05:00`);
  const thirty = (hhmm: string) =>
    [at(hhmm), new Date(at(hhmm).getTime() + 30 * 60_000)] as const;
  const weekdays = [1, 2, 3, 4, 5].flatMap((day) => [
    { day_of_week: day, start_time: '09:00', end_time: '13:00' },
    { day_of_week: day, start_time: '14:00', end_time: '18:00' },
  ]);

  it('sin configurar (null) no limita; [] = cerrado siempre (los dos canales)', () => {
    for (const channel of [APP, WEB]) {
      expect(fitsOpeningHours(...thirty('03:00'), null, BOGOTA, channel)).toBe(
        true,
      );
      expect(fitsOpeningHours(...thirty('10:00'), [], BOGOTA, channel)).toBe(
        false,
      );
    }
  });

  it('link público (WEB): dentro de una franja sí; en el cierre de mediodía, antes o después no; sábado cerrado', () => {
    const fits = (hhmm: string) =>
      fitsOpeningHours(...thirty(hhmm), weekdays, BOGOTA, WEB);
    expect(fits('09:00')).toBe(true);
    expect(fits('12:30')).toBe(true);
    expect(fits('12:45')).toBe(false); // cruza el cierre de las 13:00
    expect(fits('13:15')).toBe(false); // en el almuerzo
    expect(fits('08:45')).toBe(false);
    expect(fits('17:45')).toBe(false);
    const saturday = new Date('2030-01-12T10:00:00-05:00');
    expect(
      fitsOpeningHours(
        saturday,
        new Date(saturday.getTime() + 30 * 60_000),
        weekdays,
        BOGOTA,
        WEB,
      ),
    ).toBe(false);
  });

  it('app (APP, D-26): el día de corrido, de la primera apertura al último cierre; antes, después y el sábado siguen cerrados', () => {
    const fits = (hhmm: string) =>
      fitsOpeningHours(...thirty(hhmm), weekdays, BOGOTA, APP);
    expect(fits('09:00')).toBe(true);
    expect(fits('12:45')).toBe(true); // cruza el almuerzo
    expect(fits('13:15')).toBe(true); // en el almuerzo
    expect(fits('17:30')).toBe(true); // termina justo al cierre
    expect(fits('08:45')).toBe(false);
    expect(fits('17:45')).toBe(false);
    const saturday = new Date('2030-01-12T10:00:00-05:00');
    expect(
      fitsOpeningHours(
        saturday,
        new Date(saturday.getTime() + 30 * 60_000),
        weekdays,
        BOGOTA,
        APP,
      ),
    ).toBe(false);
  });

  it('ventanas por canal: WEB las franjas; APP un tramo por día (sin importar el orden ni franjas metidas dentro)', () => {
    const hours = [
      { day_of_week: 3, start_time: '15:00', end_time: '19:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
      { day_of_week: 1, start_time: '08:00', end_time: '12:00' },
      { day_of_week: 1, start_time: '10:00', end_time: '11:00' },
    ];
    expect(openingHoursWindows(hours, WEB)).toHaveLength(4);
    expect(openingHoursDaySpans(hours)).toEqual([
      { day_of_week: 1, start_time: '08:00', end_time: '18:00' },
      { day_of_week: 3, start_time: '15:00', end_time: '19:00' },
    ]);
    expect(openingHoursWindows(hours, APP)).toEqual([
      {
        day_of_week: 1,
        start_time: '08:00',
        end_time: '18:00',
        is_available: true,
      },
      {
        day_of_week: 3,
        start_time: '15:00',
        end_time: '19:00',
        is_available: true,
      },
    ]);
    // `details.hours` de OUTSIDE_BUSINESS_HOURS: lo que cuenta en cada canal.
    const monday = at('07:00');
    expect(dayWindows(monday, openingHoursWindows(hours, WEB), BOGOTA)).toEqual(
      [
        { start: '08:00', end: '12:00' },
        { start: '10:00', end: '11:00' },
        { start: '14:00', end: '18:00' },
      ],
    );
    expect(dayWindows(monday, openingHoursWindows(hours, APP), BOGOTA)).toEqual(
      [{ start: '08:00', end: '18:00' }],
    );
    // Día cerrado: vacío en los dos.
    const tuesday = new Date('2030-01-08T10:00:00-05:00');
    for (const channel of [APP, WEB]) {
      expect(
        dayWindows(tuesday, openingHoursWindows(hours, channel), BOGOTA),
      ).toEqual([]);
    }
  });

  it('en la zona del negocio: las 10:00 de Caracas son las 09:00 de Bogotá', () => {
    const start = new Date('2030-01-07T14:00:00Z'); // 09:00 Bogotá, 10:00 Caracas
    const end = new Date(start.getTime() + 30 * 60_000);
    const tenToSix = [
      { day_of_week: 1, start_time: '10:00', end_time: '18:00' },
    ];
    for (const channel of [APP, WEB]) {
      expect(
        fitsOpeningHours(start, end, tenToSix, 'America/Caracas', channel),
      ).toBe(true);
      expect(fitsOpeningHours(start, end, tenToSix, BOGOTA, channel)).toBe(
        false,
      );
    }
  });

  it('cierre antes de la apertura: error claro; orden estable', () => {
    expect(
      openingHoursError([
        { day_of_week: 1, start_time: '18:00', end_time: '09:00' },
      ]),
    ).toContain('posterior');
    expect(openingHoursError(weekdays)).toBeNull();
    expect(
      sortOpeningHours([
        { day_of_week: 2, start_time: '09:00', end_time: '10:00' },
        { day_of_week: 1, start_time: '14:00', end_time: '15:00' },
        { day_of_week: 1, start_time: '09:00', end_time: '10:00' },
      ]).map((r) => `${r.day_of_week} ${r.start_time}`),
    ).toEqual(['1 09:00', '1 14:00', '2 09:00']);
  });
});
