import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { INVALID_TIME_ZONE_MESSAGE } from 'src/common/decorators/is-time-zone.decorator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { BusinessSettings } from './entities/business-settings.entity';
import {
  TIMEZONE_CACHE_TTL_MS,
  TenantSettingsService,
} from './tenant-settings.service';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';
const OTHER = '0f2ac72d-a104-4782-81c0-1178c7503c54';

function build(rows: Record<string, string> = {}) {
  const repo = {
    findOne: jest.fn(async ({ where }) =>
      rows[where.tenant_id]
        ? { tenant_id: where.tenant_id, timezone: rows[where.tenant_id] }
        : null,
    ),
    save: jest.fn(async (row: BusinessSettings) => {
      rows[row.tenant_id] = row.timezone;
      return row;
    }),
    insert: jest.fn(async (row: BusinessSettings) => {
      rows[row.tenant_id] = row.timezone;
    }),
  };
  const service = new TenantSettingsService(repo as any);
  return { service, repo, rows };
}

describe('UpdateSettingsDto: zona IANA (6.01)', () => {
  const errorsFor = async (timezone: unknown) =>
    validate(plainToInstance(UpdateSettingsDto, { timezone }));

  it.each(['America/Bogota', 'America/Caracas', 'Europe/Madrid', 'UTC'])(
    '%s es válida',
    async (timezone) => {
      expect(await errorsFor(timezone)).toHaveLength(0);
    },
  );

  it.each([
    'Mars/Phobos',
    'Bogota',
    '-05:00',
    '+03:00',
    'GMT-5',
    '',
    '   ',
    'America/Bogota; DROP TABLE users',
    'x'.repeat(65),
    5,
    true,
    ['America/Bogota'],
  ])('%p no es válida: mensaje claro', async (timezone) => {
    const errors = await errorsFor(timezone);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual({
      isIanaTimeZone: INVALID_TIME_ZONE_MESSAGE,
    });
  });

  it('sin zona (PATCH vacío) no falla', async () => {
    expect(await validate(plainToInstance(UpdateSettingsDto, {}))).toEqual([]);
  });
});

describe('TenantSettingsService (6.01)', () => {
  const saved = process.env.BUSINESS_TIMEZONE;
  beforeAll(() => Logger.overrideLogger(false));
  afterEach(() => {
    jest.useRealTimers();
    if (saved === undefined) delete process.env.BUSINESS_TIMEZONE;
    else process.env.BUSINESS_TIMEZONE = saved;
  });

  describe('getTimezone: caché', () => {
    it('lee la BD una vez y después responde desde la caché, por tenant', async () => {
      const { service, repo } = build({
        [TENANT]: 'America/Bogota',
        [OTHER]: 'America/Caracas',
      });
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
      expect(await service.getTimezone(OTHER)).toBe('America/Caracas');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });

    it('el PATCH invalida la caché del tenant', async () => {
      const { service, repo } = build({ [TENANT]: 'America/Bogota' });
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
      await service.updateSettings(TENANT, { timezone: 'America/Caracas' });
      expect(await service.getTimezone(TENANT)).toBe('America/Caracas');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: TENANT,
          timezone: 'America/Caracas',
        }),
      );
    });

    it('caduca a los 5 minutos (otras instancias)', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
      const { service, repo, rows } = build({ [TENANT]: 'America/Bogota' });
      await service.getTimezone(TENANT);
      rows[TENANT] = 'Europe/Madrid'; // la cambió otra instancia
      jest.advanceTimersByTime(TIMEZONE_CACHE_TTL_MS - 1);
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
      jest.advanceTimersByTime(2);
      expect(await service.getTimezone(TENANT)).toBe('Europe/Madrid');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });

    it('sin fila: BUSINESS_TIMEZONE, sin escribir', async () => {
      process.env.BUSINESS_TIMEZONE = 'Europe/Madrid';
      const { service, repo } = build();
      expect(await service.getTimezone(TENANT)).toBe('Europe/Madrid');
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('zona guardada que Intl no reconoce: BUSINESS_TIMEZONE', async () => {
      delete process.env.BUSINESS_TIMEZONE;
      const { service } = build({ [TENANT]: 'Mars/Phobos' });
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
    });

    it('sin tenant: lanza (nunca consulta sin filtro)', async () => {
      const { service, repo } = build();
      await expect(service.getTimezone('')).rejects.toThrow();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateSettings', () => {
    it('guarda el nombre canónico', async () => {
      const { service, rows } = build({ [TENANT]: 'America/Bogota' });
      expect(
        await service.updateSettings(TENANT, { timezone: 'america/caracas' }),
      ).toEqual({ timezone: 'America/Caracas' });
      expect(rows[TENANT]).toBe('America/Caracas');
    });

    it('misma zona o sin zona: no escribe', async () => {
      const { service, repo } = build({ [TENANT]: 'America/Bogota' });
      await service.updateSettings(TENANT, { timezone: 'America/Bogota' });
      await service.updateSettings(TENANT, {});
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('negocio sin fila: la crea', async () => {
      const { service, repo } = build();
      await service.updateSettings(TENANT, { timezone: 'Europe/Madrid' });
      expect(repo.insert).toHaveBeenCalledWith({
        tenant_id: TENANT,
        timezone: 'Europe/Madrid',
      });
    });
  });

  describe('alta: createForTenant / initialTimezone', () => {
    const manager = () => ({
      create: jest.fn((_entity, data) => data),
      save: jest.fn(async (row) => row),
    });

    it('con la zona del dispositivo: la guarda (canónica) con el manager de la transacción', async () => {
      const { service } = build();
      const m = manager();
      await service.createForTenant(TENANT, 'America/Caracas', m as any);
      expect(m.save).toHaveBeenCalledWith({
        tenant_id: TENANT,
        timezone: 'America/Caracas',
      });
    });

    it.each([[undefined], [null], [''], ['Mars/Phobos'], ['-04:00'], [42]])(
      'sin zona o inválida (%p): BUSINESS_TIMEZONE',
      async (requested) => {
        process.env.BUSINESS_TIMEZONE = 'Europe/Madrid';
        const { service } = build();
        const m = manager();
        await service.createForTenant(TENANT, requested, m as any);
        expect(m.save).toHaveBeenCalledWith({
          tenant_id: TENANT,
          timezone: 'Europe/Madrid',
        });
      },
    );

    it('sin BUSINESS_TIMEZONE: America/Bogota', () => {
      delete process.env.BUSINESS_TIMEZONE;
      expect(build().service.initialTimezone(undefined)).toBe('America/Bogota');
    });

    it('invalida una caché previa del tenant', async () => {
      const { service, repo, rows } = build();
      expect(await service.getTimezone(TENANT)).toBe('America/Bogota');
      rows[TENANT] = 'America/Caracas';
      await service.createForTenant(
        TENANT,
        'America/Caracas',
        manager() as any,
      );
      expect(await service.getTimezone(TENANT)).toBe('America/Caracas');
      expect(repo.findOne).toHaveBeenCalledTimes(2);
    });
  });
});
