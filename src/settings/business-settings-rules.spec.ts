import { firstFreeSlug, slugify } from './business-slug';
import {
  fitsOpeningHours,
  openingHoursError,
  sortOpeningHours,
} from './opening-hours';

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

  it('sin configurar (null) no limita; [] = cerrado siempre', () => {
    expect(fitsOpeningHours(...thirty('03:00'), null, BOGOTA)).toBe(true);
    expect(fitsOpeningHours(...thirty('10:00'), [], BOGOTA)).toBe(false);
  });

  it('dentro de una franja sí; en el cierre de mediodía, antes o después no; sábado cerrado', () => {
    expect(fitsOpeningHours(...thirty('09:00'), weekdays, BOGOTA)).toBe(true);
    expect(fitsOpeningHours(...thirty('12:30'), weekdays, BOGOTA)).toBe(true);
    expect(fitsOpeningHours(...thirty('12:45'), weekdays, BOGOTA)).toBe(false);
    expect(fitsOpeningHours(...thirty('08:45'), weekdays, BOGOTA)).toBe(false);
    expect(fitsOpeningHours(...thirty('17:45'), weekdays, BOGOTA)).toBe(false);
    const saturday = new Date('2030-01-12T10:00:00-05:00');
    expect(
      fitsOpeningHours(
        saturday,
        new Date(saturday.getTime() + 30 * 60_000),
        weekdays,
        BOGOTA,
      ),
    ).toBe(false);
  });

  it('en la zona del negocio: las 10:00 de Caracas son las 09:00 de Bogotá', () => {
    const start = new Date('2030-01-07T14:00:00Z'); // 09:00 Bogotá, 10:00 Caracas
    const end = new Date(start.getTime() + 30 * 60_000);
    const tenToSix = [
      { day_of_week: 1, start_time: '10:00', end_time: '18:00' },
    ];
    expect(fitsOpeningHours(start, end, tenToSix, 'America/Caracas')).toBe(
      true,
    );
    expect(fitsOpeningHours(start, end, tenToSix, BOGOTA)).toBe(false);
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
