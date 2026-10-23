import { BadRequestException } from '@nestjs/common';
import { TimeBlocksService } from './time-blocks.service';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const PRO = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build() {
  const order: string[] = [];
  const db = { blocks: [] as any[] };
  const txRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => {
      order.push('save');
      return { id: 'bloque', ...x };
    }),
  };
  const manager = {
    getRepository: jest.fn(() => txRepo),
    query: jest.fn<Promise<any[]>, [string, unknown[]?]>(async (sql) => {
      order.push('blocks');
      if (sql.includes('FROM time_block')) return db.blocks;
      throw new Error(`SQL inesperado: ${sql}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: any) => Promise<any>) =>
      work(manager),
    ),
  };
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(),
    find: jest.fn(async () => []),
  };
  const users = {
    findTenantMember: jest.fn(async (id: string) => ({ id })),
  };
  const appointments = {
    findOne: jest.fn(async (id: string) => ({ id })),
    assertNoAppointmentOverlap: jest.fn<Promise<void>, [any, any]>(async () => {
      order.push('appointments');
    }),
  };
  const service = new TimeBlocksService(
    repo as any,
    users as any,
    appointments as any,
    dataSource as any,
  );
  return { service, repo, users, appointments, manager, txRepo, db, order };
}

const dto = {
  user_id: PRO,
  start_datetime: '2030-01-07T10:00:00',
  end_datetime: '2030-01-07T11:00:00-05:00',
};

describe('TimeBlocksService (2.08)', () => {
  it('create: fechas ISO (sin offset = hora del negocio) y validación DENTRO de la transacción', async () => {
    const { service, appointments, manager, txRepo, order } = build();
    await service.create(dto, TENANT);
    const saved = txRepo.save.mock.calls[0][0];
    expect(saved.start_datetime.toISOString()).toBe('2030-01-07T15:00:00.000Z');
    expect(saved.end_datetime.toISOString()).toBe('2030-01-07T16:00:00.000Z');
    expect(appointments.assertNoAppointmentOverlap).toHaveBeenCalledWith(
      manager,
      {
        tenantId: TENANT,
        professionalId: PRO,
        start: saved.start_datetime,
        end: saved.end_datetime,
        excludeAppointmentId: null,
      },
    );
    // Primero el lock + citas, luego los otros bloqueos, al final guardar.
    expect(order).toEqual(['appointments', 'blocks', 'save']);
  });

  it('create: encima de una cita no cancelada → SLOT_UNAVAILABLE y no guarda', async () => {
    const { service, appointments, txRepo } = build();
    appointments.assertNoAppointmentOverlap.mockRejectedValue(
      new BusinessException(
        ErrorCode.SLOT_UNAVAILABLE,
        'Horario no disponible',
      ),
    );
    await expect(service.create(dto, TENANT)).rejects.toMatchObject({
      code: ErrorCode.SLOT_UNAVAILABLE,
    });
    expect(txRepo.save).not.toHaveBeenCalled();
  });

  it('create: un bloqueo ligado a una cita no choca con esa cita', async () => {
    const { service, appointments } = build();
    await service.create({ ...dto, appointment_id: 'cita-1' }, TENANT);
    expect(appointments.findOne).toHaveBeenCalledWith('cita-1', TENANT);
    expect(
      appointments.assertNoAppointmentOverlap.mock.calls[0][1],
    ).toMatchObject({ excludeAppointmentId: 'cita-1' });
  });

  it('create: cruce con otro bloqueo → 400; rango invertido → 400 sin abrir transacción', async () => {
    const { service, db, txRepo } = build();
    db.blocks = [{}];
    await expect(service.create(dto, TENANT)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(txRepo.save).not.toHaveBeenCalled();

    const fresh = build();
    await expect(
      fresh.service.create(
        { ...dto, end_datetime: '2030-01-07T09:00:00' },
        TENANT,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fresh.users.findTenantMember).not.toHaveBeenCalled();
  });

  it('update: cambiar solo el inicio valida el rango resultante contra citas (excluye la cita ligada y el propio bloqueo)', async () => {
    const { service, repo, appointments, manager } = build();
    repo.findOne.mockResolvedValue({
      id: 'bloque',
      user: { id: PRO },
      appointment: { id: 'cita-1' },
      start_datetime: new Date('2030-01-07T15:00:00Z'),
      end_datetime: new Date('2030-01-07T16:00:00Z'),
    });
    await service.update(
      'bloque',
      { start_datetime: '2030-01-07T09:30:00' },
      TENANT,
    );
    expect(appointments.assertNoAppointmentOverlap).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        start: new Date('2030-01-07T14:30:00Z'),
        end: new Date('2030-01-07T16:00:00Z'),
        excludeAppointmentId: 'cita-1',
      }),
    );
    const [, params] = manager.query.mock.calls[0];
    expect(params?.[3]).toBe('bloque');
  });

  it('update: solo notas no revisa el hueco', async () => {
    const { service, repo, appointments } = build();
    repo.findOne.mockResolvedValue({
      id: 'bloque',
      user: { id: PRO },
      start_datetime: new Date('2030-01-07T15:00:00Z'),
      end_datetime: new Date('2030-01-07T16:00:00Z'),
    });
    await service.update('bloque', { notes: 'x' }, TENANT);
    expect(appointments.assertNoAppointmentOverlap).not.toHaveBeenCalled();
  });
});
