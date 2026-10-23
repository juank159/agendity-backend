import { parseBusinessDate, toBusinessIso } from 'src/common/utils/date.util';
import {
  appointmentEnd,
  fitsSchedule,
  ScheduleWindow,
} from './appointment-slot';
import {
  reminderLeadMinutes,
  reminderMessage,
  reminderTimeFor,
} from './appointment-reminder.service';

/**
 * Escenario del reporte de integración (2026-10-21, §3.1): cita a las 08:00 en
 * Bogotá. Debe dar lo mismo con el proceso en America/Bogota o en UTC (estos
 * tests se corren con las dos zonas).
 */
describe('Cita a las 08:00 en Bogotá (2.05)', () => {
  // Lo que manda hoy la app: `toLocal().toIso8601String()`, sin offset.
  const fromApp = '2026-10-21T08:00:00.000';
  const start = parseBusinessDate(fromApp);
  const services = [{ duration: 30 }];

  // Horario del profesional: lunes a viernes 09:00-18:00 (hora del negocio).
  const weekdays9to18: ScheduleWindow[] = [1, 2, 3, 4, 5].map((day) => ({
    day_of_week: day,
    start_time: '09:00:00',
    end_time: '18:00:00',
    is_available: true,
  }));

  it('se guarda como las 13:00 UTC y se lee como 08:00-05:00', () => {
    expect(start.toISOString()).toBe('2026-10-21T13:00:00.000Z');
    expect(toBusinessIso(start)).toBe('2026-10-21T08:00:00.000-05:00');
    // La app (Dart) lee lo mismo con o sin offset de Bogotá:
    expect(parseBusinessDate('2026-10-21T08:00:00.000-05:00')).toEqual(start);
  });

  it('el horario 09-18 la rechaza; a las 09:00 cabe', () => {
    expect(
      fitsSchedule(start, appointmentEnd(start, services), weekdays9to18),
    ).toBe(false);
    const nine = parseBusinessDate('2026-10-21T09:00:00.000');
    expect(
      fitsSchedule(nine, appointmentEnd(nine, services), weekdays9to18),
    ).toBe(true);
    // 17:45 + 30 min se pasa de las 18:00
    const late = parseBusinessDate('2026-10-21T17:45:00.000');
    expect(
      fitsSchedule(late, appointmentEnd(late, services), weekdays9to18),
    ).toBe(false);
  });

  it('el recordatorio sale a las 07:00 (≥ 24 h), 07:30 (≥ 2 h) o 07:45 (< 2 h) de Bogotá', () => {
    const at = (wall: string) => parseBusinessDate(wall);
    const cases: [string, number, string][] = [
      ['2026-10-20T08:00:00', 60, '2026-10-21T07:00:00.000-05:00'],
      ['2026-10-21T05:00:00', 30, '2026-10-21T07:30:00.000-05:00'],
      ['2026-10-21T07:00:00', 15, '2026-10-21T07:45:00.000-05:00'],
    ];
    for (const [now, lead, expected] of cases) {
      expect(reminderLeadMinutes(start, at(now))).toBe(lead);
      expect(toBusinessIso(reminderTimeFor(start, at(now)))).toBe(expected);
    }
  });

  it('el texto del recordatorio dice la hora de Bogotá', () => {
    const message = reminderMessage({
      date: start,
      services: [{ name: 'Cejas' }],
    } as any);
    expect(message).toContain('*miércoles 21 de octubre*');
    expect(message).toContain('*8:00 AM*');
  });
});
