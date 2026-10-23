import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto';
import { UpdateAppointmentDto } from './update-appointment.dto';

const S1 = 'c0000000-0000-4000-8000-000000000001';
const S2 = 'c0000000-0000-4000-8000-000000000002';
const base = {
  client_id: 'c0000000-0000-4000-8000-000000000003',
  professional_id: 'c0000000-0000-4000-8000-000000000004',
  date: '2030-01-07T10:00:00',
};

async function serviceIdErrors(cls: any, body: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body) as object);
  return errors
    .filter((e) => e.property === 'service_ids')
    .flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('service_ids de la cita (2.08)', () => {
  it('crear: al menos uno y sin repetidos', async () => {
    expect(
      await serviceIdErrors(CreateAppointmentDto, { ...base, service_ids: [] }),
    ).toContain('arrayMinSize');
    expect(
      await serviceIdErrors(CreateAppointmentDto, {
        ...base,
        service_ids: [S1, S1],
      }),
    ).toContain('arrayUnique');
    expect(
      await serviceIdErrors(CreateAppointmentDto, {
        ...base,
        service_ids: [S1, S2],
      }),
    ).toEqual([]);
  });

  it('editar: opcional, pero si viene, misma regla', async () => {
    expect(await serviceIdErrors(UpdateAppointmentDto, {})).toEqual([]);
    expect(
      await serviceIdErrors(UpdateAppointmentDto, { service_ids: [] }),
    ).toContain('arrayMinSize');
    expect(
      await serviceIdErrors(UpdateAppointmentDto, { service_ids: [S2, S2] }),
    ).toContain('arrayUnique');
  });
});
