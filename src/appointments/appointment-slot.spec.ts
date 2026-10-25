import { AppointmentStatus } from 'src/common/enums/status.enum';
import {
  appointmentDurationMinutes,
  appointmentDurationSql,
  appointmentEnd,
  blocksSlot,
  DEFAULT_SERVICE_DURATION_MINUTES,
  fitsSchedule,
  assertStartNotInPast,
  freeSlotStarts,
  intervalsOverlap,
  isRescheduled,
  startsInPast,
  isoWeekday,
  ScheduleWindow,
  timeToMinutes,
} from './appointment-slot';

// Instantes explícitos en Bogotá (zona del negocio por defecto): el resultado
// no depende de la zona del proceso (los tests corren también con TZ=UTC).
const monday = (hhmm: string) => new Date(`2099-01-05T${hhmm}:00-05:00`);
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
    expect(isoWeekday(new Date('2099-01-04T10:00:00-05:00'))).toBe(7);
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
      const sunday = new Date('2099-01-04T10:00:00-05:00');
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

describe('freeSlotStarts (huecos libres de un día, 2.14)', () => {
  const dayStart = monday('00:00');
  const nextDayStart = new Date('2099-01-06T00:00:00-05:00');
  const hhmm = (dates: Date[]) =>
    dates.map((d) =>
      new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(11, 16),
    );
  const base = {
    dayStart,
    nextDayStart,
    durationMinutes: 60,
    stepMinutes: 30,
    schedules: weekdays('09:00', '12:00'),
    busy: [],
  };

  it('dentro del horario y sin pasar del cierre (cita de 60 min, paso 30)', () => {
    expect(hhmm(freeSlotStarts(base))).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('una cita o un bloqueo ocupan [inicio, fin): se puede empezar al terminar', () => {
    const busy = [{ start: monday('10:00'), end: monday('10:30') }];
    expect(hhmm(freeSlotStarts({ ...base, busy }))).toEqual([
      '09:00',
      '10:30',
      '11:00',
    ]);
  });

  it('día sin franja del profesional (domingo) → ninguno', () => {
    const sunday = new Date('2099-01-04T00:00:00-05:00');
    expect(
      freeSlotStarts({ ...base, dayStart: sunday, nextDayStart: dayStart }),
    ).toEqual([]);
  });

  it('sin horario configurado no restringe: todo el día, incluso cruzando medianoche', () => {
    const slots = freeSlotStarts({ ...base, schedules: [], stepMinutes: 60 });
    expect(slots).toHaveLength(24);
    expect(hhmm(slots).at(-1)).toBe('23:00');
  });

  it('paso no positivo → lista vacía (nunca un bucle infinito)', () => {
    expect(freeSlotStarts({ ...base, stepMinutes: 0 })).toEqual([]);
  });

  it('coincide con la regla de guardar (fitsSchedule + cruces) en cada candidato', () => {
    const busy = [
      { start: monday('09:45'), end: monday('10:15') },
      { start: monday('11:30'), end: monday('11:30') }, // cita de 0 min
    ];
    const free = new Set(
      freeSlotStarts({ ...base, busy, stepMinutes: 15 }).map((d) =>
        d.getTime(),
      ),
    );
    for (let t = dayStart.getTime(); t < nextDayStart.getTime(); t += 900_000) {
      const slot = { start: new Date(t), end: new Date(t + 3_600_000) };
      const allowed =
        fitsSchedule(slot.start, slot.end, base.schedules) &&
        !busy.some((b) => intervalsOverlap(slot, b));
      expect([slot.start.toISOString(), free.has(t)]).toEqual([
        slot.start.toISOString(),
        allowed,
      ]);
    }
  });

  it('intervalsOverlap es semiabierto, como las consultas SQL', () => {
    const a = { start: monday('09:00'), end: monday('10:00') };
    expect(
      intervalsOverlap(a, { start: monday('10:00'), end: monday('11:00') }),
    ).toBe(false);
    expect(
      intervalsOverlap(a, { start: monday('09:59'), end: monday('11:00') }),
    ).toBe(true);
    // Cita de 0 min estrictamente dentro: en SQL (date < fin AND date + 0 > inicio) también cuenta.
    expect(
      intervalsOverlap(a, { start: monday('09:30'), end: monday('09:30') }),
    ).toBe(true);
  });
});

describe('solo a futuro (2.21)', () => {
  const now = new Date('2099-01-05T10:07:00-05:00');

  it('startsInPast: antes de ahora sí; justo ahora o después, no', () => {
    expect(startsInPast(new Date('2099-01-05T10:06:59-05:00'), now)).toBe(true);
    expect(startsInPast(now, now)).toBe(false);
    expect(startsInPast(new Date('2099-01-05T10:30:00-05:00'), now)).toBe(
      false,
    );
  });

  it('assertStartNotInPast → APPOINTMENT_IN_PAST (400)', () => {
    let error: any;
    try {
      assertStartNotInPast(new Date('2099-01-05T09:00:00-05:00'), now);
    } catch (e) {
      error = e;
    }
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'APPOINTMENT_IN_PAST' });
    expect(() => assertStartNotInPast(now, now)).not.toThrow();
  });

  it('freeSlotStarts con now: oculta las horas pasadas de hoy (misma regla)', () => {
    const slots = freeSlotStarts({
      dayStart: monday('00:00'),
      nextDayStart: new Date('2099-01-06T00:00:00-05:00'),
      durationMinutes: 30,
      stepMinutes: 30,
      schedules: weekdays('09:00', '12:00'),
      busy: [],
      now,
    });
    expect(slots).toEqual([monday('10:30'), monday('11:00'), monday('11:30')]);
    expect(slots.some((s) => startsInPast(s, now))).toBe(false);
  });

  it('isRescheduled: misma fecha (otro formato u objeto) no es mover', () => {
    const date = new Date('2099-01-05T10:00:00-05:00');
    expect(isRescheduled(date, new Date(date.getTime()))).toBe(false);
    expect(isRescheduled('2099-01-05T15:00:00.000Z', date)).toBe(false);
    expect(isRescheduled(date, undefined)).toBe(false);
    expect(isRescheduled(date, new Date(date.getTime() + 60_000))).toBe(true);
  });
});
