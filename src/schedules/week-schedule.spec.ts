import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEmployeeDto } from 'src/auth/dto/create-employee.dto';
import { UpdateEmployeeDto } from 'src/auth/dto/update-employee.dto';
import {
  ScheduleRow,
  planScheduleChanges,
  scheduleViews,
  weekScheduleError,
} from './week-schedule';

const row = (
  id: string,
  day: number,
  start: string,
  end: string,
  is_available = true,
): ScheduleRow => ({
  id,
  day_of_week: day,
  start_time: `${start}:00`,
  end_time: `${end}:00`,
  is_available,
});

// Lunes partido (09-13 y 14-18, guardado en desorden), martes completo y una
// fila de no disponibilidad el miércoles.
const existing = [
  row('lun-tarde', 1, '14:00', '18:00'),
  row('lun-manana', 1, '09:00', '13:00'),
  row('mar', 2, '09:00', '18:00'),
  row('mie-no', 3, '10:00', '12:00', false),
];

describe('Horario semanal del empleado (13.04)', () => {
  describe('scheduleViews', () => {
    it('todas las franjas disponibles por día, ordenadas y en HH:mm; `schedule` con la primera', () => {
      expect(scheduleViews(existing)).toEqual({
        schedule_slots: {
          monday: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '18:00' },
          ],
          tuesday: [{ start: '09:00', end: '18:00' }],
        },
        schedule: {
          monday: { start: '09:00', end: '13:00' },
          tuesday: { start: '09:00', end: '18:00' },
        },
      });
    });

    it('is_available=false no aparece; sin filas, vacío', () => {
      expect(scheduleViews([existing[3]])).toEqual({
        schedule: {},
        schedule_slots: {},
      });
      expect(scheduleViews(undefined)).toEqual({
        schedule: {},
        schedule_slots: {},
      });
    });
  });

  describe('weekScheduleError', () => {
    it('acepta el formato nuevo, el anterior y franjas que se tocan', () => {
      expect(
        weekScheduleError({
          monday: [
            { start: '09:00', end: '13:00' },
            { start: '13:00', end: '18:00' },
          ],
          tuesday: { start: '09:00', end: '18:00' },
          sunday: [],
        }),
      ).toBeNull();
    });

    it.each([
      [[], /objeto/],
      [{ lunes: [] }, /Día de la semana no válido/],
      [{ monday: [{ start: '9:00', end: '13:00' }] }, /HH:mm/],
      [{ monday: { start: '09:00:00', end: '13:00' } }, /HH:mm/],
      [{ monday: [{ start: '13:00', end: '09:00' }] }, /posterior/],
      [{ monday: { start: '09:00', end: '09:00' } }, /posterior/],
      [{ monday: [{ start: '09:00' }] }, /inicio y fin/],
      [{ monday: 'todo el día' }, /inicio y fin/],
      [
        {
          monday: [
            { start: '14:00', end: '18:00' },
            { start: '09:00', end: '14:30' },
          ],
        },
        /se solapan/,
      ],
    ])('rechaza %j', (value, message) => {
      expect(weekScheduleError(value)).toMatch(message);
    });

    it('el DTO de alta y el de edición lo validan (400 con el motivo)', async () => {
      const bad = {
        monday: [
          { start: '09:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ],
      };
      const update = await validate(
        plainToInstance(UpdateEmployeeDto, { schedule: bad }),
      );
      expect(
        update.map((e) => Object.values(e.constraints ?? {})).flat(),
      ).toEqual([expect.stringMatching(/se solapan/)]);
      const create = await validate(
        plainToInstance(CreateEmployeeDto, {
          name: 'Ana',
          lastname: 'Ruiz',
          email: 'ana@example.com',
          phone: '3001234567',
          password: 'Secreta1!',
          schedule: { monday: [{ start: '09:00', end: '12:00' }] },
        }),
      );
      expect(create).toEqual([]);
      expect(
        await validate(plainToInstance(UpdateEmployeeDto, { name: 'Ana' })),
      ).toEqual([]);
    });
  });

  describe('planScheduleChanges', () => {
    it('formato nuevo: el día queda con esas franjas; las que no cambian conservan su id', () => {
      const changes = planScheduleChanges(existing, {
        monday: [
          { start: '09:00', end: '13:00' },
          { start: '15:00', end: '19:00' },
        ],
        tuesday: [{ start: '09:00', end: '18:00' }],
      });
      expect(changes).toEqual({
        deleteIds: ['lun-tarde'],
        insert: [{ day_of_week: 1, start_time: '15:00', end_time: '19:00' }],
      });
    });

    it('formato anterior con la primera franja que vio la app: no borra la de la tarde', () => {
      expect(
        planScheduleChanges(existing, {
          monday: { start: '09:00', end: '13:00' },
          tuesday: { start: '09:00', end: '18:00' },
        }),
      ).toEqual({ deleteIds: [], insert: [] });
    });

    it('formato anterior con otra franja: sustituye a las que se cruzan y conserva las demás', () => {
      expect(
        planScheduleChanges(existing, {
          monday: { start: '08:00', end: '12:00' },
          tuesday: { start: '09:00', end: '18:00' },
        }),
      ).toEqual({
        deleteIds: ['lun-manana'],
        insert: [{ day_of_week: 1, start_time: '08:00', end_time: '12:00' }],
      });
    });

    it('un día que no viene se queda sin franjas; la fila no disponible no se toca', () => {
      expect(
        planScheduleChanges(existing, {
          tuesday: [{ start: '09:00', end: '18:00' }],
        }),
      ).toEqual({ deleteIds: ['lun-tarde', 'lun-manana'], insert: [] });
      expect(planScheduleChanges(existing, {}).deleteIds).not.toContain(
        'mie-no',
      );
    });

    it('alta (sin filas): crea todas las franjas', () => {
      expect(
        planScheduleChanges([], {
          friday: [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '18:00' },
          ],
        }).insert,
      ).toEqual([
        { day_of_week: 5, start_time: '09:00', end_time: '13:00' },
        { day_of_week: 5, start_time: '14:00', end_time: '18:00' },
      ]);
    });
  });
});
