import { AppointmentStatus } from 'src/common/enums/status.enum';
import {
  appointmentDurationMinutes,
  appointmentDurationSql,
  appointmentEnd,
  blocksSlot,
  DEFAULT_SERVICE_DURATION_MINUTES,
  fitsSchedule,
  isoWeekday,
  ScheduleWindow,
  timeToMinutes,
} from './appointment-slot';

// Fechas sin zona = hora local del proceso, como las guarda `appointments.date`.
const monday = (hhmm: string) => new Date(`2099-01-05T${hhmm}:00`);
const weekdays = (start = '09:00', end = '18:00'): ScheduleWindow[] =>
  [1, 2, 3, 4, 5].map((d) => ({
    day_of_week: d,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    is_available: true,
  }));

describe('appointment-slot (reglas puras de 2.04)', () => {
  describe('duración y fin', () => {
    it('un servicio sin duración (null, 0, vacío) cuenta 30 min', () => {
      expect(DEFAULT_SERVICE_DURATION_MINUTES).toBe(30);
      expect(
        appointmentDurationMinutes([
          { duration: null },
          { duration: 0 },
          {},
          { duration: '45' },
        ]),
      ).toBe(30 + 30 + 30 + 45);
    });

    it('el fin es el inicio + la suma de duraciones', () => {
      expect(
        appointmentEnd(monday('10:00'), [{ duration: 60 }, { duration: null }]),
      ).toEqual(monday('11:30'));
      expect(appointmentEnd(monday('10:00'), [])).toEqual(monday('10:00'));
    });

    it('la versión SQL usa la misma regla (sin servicios = 0; <= 0 o null = 30)', () => {
      const sql = appointmentDurationSql('s');
      expect(sql).toContain('WHEN s.id IS NULL THEN 0');
      expect(sql).toContain('WHEN s.duration > 0 THEN s.duration');
      expect(sql).toContain(`ELSE ${DEFAULT_SERVICE_DURATION_MINUTES} END`);
    });
  });

  it('solo CANCELLED deja libre el hueco', () => {
    expect(blocksSlot(AppointmentStatus.CANCELLED)).toBe(false);
    expect(blocksSlot(AppointmentStatus.PENDING)).toBe(true);
    expect(blocksSlot(AppointmentStatus.CONFIRMED)).toBe(true);
    expect(blocksSlot(AppointmentStatus.COMPLETED)).toBe(true);
  });

  it('día ISO: lunes = 1, domingo = 7 (como schedules.day_of_week)', () => {
    expect(isoWeekday(monday('10:00'))).toBe(1);
    expect(isoWeekday(new Date('2099-01-04T10:00:00'))).toBe(7);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('18:00:00')).toBe(1080);
  });

  describe('horario del profesional', () => {
    const fits = (from: string, to: string, s = weekdays()) =>
      fitsSchedule(monday(from), monday(to), s);

    it('sin horario configurado no restringe', () => {
      expect(fits('03:00', '04:00', [])).toBe(true);
    });

    it('dentro de la franja, incluidos los bordes', () => {
      expect(fits('09:00', '10:00')).toBe(true);
      expect(fits('17:00', '18:00')).toBe(true);
    });

    it('fuera de horario o pisando el borde: no cabe', () => {
      expect(fits('08:30', '09:30')).toBe(false);
      expect(fits('17:30', '18:30')).toBe(false);
      expect(fits('19:00', '19:30')).toBe(false);
    });

    it('día sin franja (domingo) o franja marcada no disponible: no cabe', () => {
      const sunday = new Date('2099-01-04T10:00:00');
      expect(
        fitsSchedule(sunday, appointmentEnd(sunday, [{}]), weekdays()),
      ).toBe(false);
      const off = weekdays().map((s) => ({ ...s, is_available: false }));
      expect(fits('10:00', '11:00', off)).toBe(false);
    });

    it('franjas contiguas del mismo día se unen; con hueco entre medias, no', () => {
      const split = (gapEnd: string): ScheduleWindow[] => [
        {
          day_of_week: 1,
          start_time: '09:00',
          end_time: '13:00',
          is_available: true,
        },
        {
          day_of_week: 1,
          start_time: gapEnd,
          end_time: '18:00',
          is_available: true,
        },
      ];
      expect(fits('12:30', '13:30', split('13:00'))).toBe(true);
      expect(fits('12:30', '13:30', split('14:00'))).toBe(false);
      expect(fits('14:00', '15:00', split('14:00'))).toBe(true);
    });

    it('una cita que pasa de medianoche nunca cabe', () => {
      const allDay: ScheduleWindow[] = [
        {
          day_of_week: 1,
          start_time: '00:00',
          end_time: '23:59',
          is_available: true,
        },
      ];
      const start = monday('23:30');
      expect(
        fitsSchedule(start, appointmentEnd(start, [{ duration: 60 }]), allDay),
      ).toBe(false);
    });
  });
});
