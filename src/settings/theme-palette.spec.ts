import { readFileSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { BusinessSettings } from './entities/business-settings.entity';
import { TenantSettingsService } from './tenant-settings.service';
import {
  DEFAULT_THEME_PALETTE,
  isThemePalette,
  storedThemePalette,
  THEME_PALETTE_MESSAGE,
  THEME_PALETTE_SEEDS,
  THEME_PALETTES,
} from './theme-palette';

const TENANT = '3275ba14-af85-42a6-b02f-199c1b4058d4';

describe('Paleta del negocio (12.01, D-22)', () => {
  it('seis paletas, lavanda por defecto, una semilla por paleta', () => {
    expect([...THEME_PALETTES]).toEqual([
      'lavanda',
      'rosa',
      'azul',
      'turquesa',
      'coral',
      'grafito',
    ]);
    expect(DEFAULT_THEME_PALETTE).toBe('lavanda');
    expect(Object.keys(THEME_PALETTE_SEEDS).sort()).toEqual(
      [...THEME_PALETTES].sort(),
    );
    expect(THEME_PALETTE_SEEDS).toMatchObject({
      lavanda: '#7C5CFC',
      rosa: '#EC4899',
      azul: '#2563EB',
      turquesa: '#0EA5A4',
      coral: '#F97316',
      grafito: '#334155',
    });
  });

  it('isThemePalette / storedThemePalette: lo desconocido cuenta como null', () => {
    expect(isThemePalette('rosa')).toBe(true);
    for (const bad of ['Rosa', 'morado', '', null, undefined, 5]) {
      expect(isThemePalette(bad)).toBe(false);
      expect(storedThemePalette(bad)).toBeNull();
    }
    expect(storedThemePalette('grafito')).toBe('grafito');
  });

  describe('UpdateSettingsDto.theme_palette', () => {
    const errorsFor = async (theme_palette: unknown) =>
      validate(plainToInstance(UpdateSettingsDto, { theme_palette }));

    it.each([...THEME_PALETTES, null])('%p es válida', async (value) => {
      expect(await errorsFor(value)).toEqual([]);
    });

    it.each(['morado', 'Rosa', '', ' rosa', '#EC4899', 5, ['rosa'], true])(
      '%p no es válida: mensaje claro',
      async (value) => {
        const errors = await errorsFor(value);
        expect(errors).toHaveLength(1);
        expect(errors[0].constraints).toEqual({ isIn: THEME_PALETTE_MESSAGE });
      },
    );
  });

  describe('TenantSettingsService', () => {
    function build(initial: Partial<BusinessSettings> | null) {
      const rows = new Map<string, BusinessSettings>();
      if (initial) {
        rows.set(TENANT, {
          tenant_id: TENANT,
          timezone: 'America/Bogota',
          name: null,
          slug: null,
          opening_hours: null,
          theme_palette: null,
          ...initial,
        } as BusinessSettings);
      }
      const repo = {
        findOne: jest.fn(
          async ({ where }) => rows.get(where.tenant_id) ?? null,
        ),
        save: jest.fn(async (row: BusinessSettings) => {
          rows.set(row.tenant_id, { ...row });
          return row;
        }),
        insert: jest.fn(async (row: BusinessSettings) => {
          rows.set(row.tenant_id, { ...row });
        }),
      };
      return { service: new TenantSettingsService(repo as any), repo, rows };
    }

    it('GET: sin elegir → null; guardada → la paleta; valor raro en la BD → null', async () => {
      expect((await build({}).service.getSettings(TENANT)).theme_palette).toBe(
        null,
      );
      expect(
        (await build({ theme_palette: 'coral' }).service.getSettings(TENANT))
          .theme_palette,
      ).toBe('coral');
      expect(
        (
          await build({ theme_palette: 'morado' as never }).service.getSettings(
            TENANT,
          )
        ).theme_palette,
      ).toBeNull();
      expect(
        (await build(null).service.getSettings(TENANT)).theme_palette,
      ).toBeNull();
    });

    it('PATCH: guarda, null vuelve al defecto; misma paleta o sin campo no escribe', async () => {
      const { service, repo, rows } = build({});
      expect(
        (await service.updateSettings(TENANT, { theme_palette: 'rosa' }))
          .theme_palette,
      ).toBe('rosa');
      expect(rows.get(TENANT)?.theme_palette).toBe('rosa');
      // La caché se invalidó: la lectura cacheada ya la ve.
      expect((await service.getCachedSettings(TENANT)).theme_palette).toBe(
        'rosa',
      );

      repo.save.mockClear();
      await service.updateSettings(TENANT, { theme_palette: 'rosa' });
      await service.updateSettings(TENANT, { name: undefined });
      expect(repo.save).not.toHaveBeenCalled();

      expect(
        (await service.updateSettings(TENANT, { theme_palette: null }))
          .theme_palette,
      ).toBeNull();
      expect(rows.get(TENANT)?.theme_palette).toBeNull();
      // Los demás ajustes no cambian.
      expect(rows.get(TENANT)?.timezone).toBe('America/Bogota');
    });

    it('PATCH null sobre un valor raro de la BD lo limpia', async () => {
      const { service, rows } = build({ theme_palette: 'morado' as never });
      await service.updateSettings(TENANT, { theme_palette: null });
      expect(rows.get(TENANT)?.theme_palette).toBeNull();
    });

    it('negocio sin fila: la crea con la paleta y la zona por defecto', async () => {
      const { service, repo } = build(null);
      await service.updateSettings(TENANT, { theme_palette: 'azul' });
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_id: TENANT, theme_palette: 'azul' }),
      );
    });
  });

  describe('web de reservas (public/reservar/styles.css)', () => {
    const css = readFileSync(
      join(__dirname, '..', '..', 'public', 'reservar', 'styles.css'),
      'utf8',
    );
    const blocks = new Map(
      [...css.matchAll(/:root\[data-palette='([a-z]+)'\]\s*\{([^}]*)\}/g)].map(
        ([, name, body]) => [name, body],
      ),
    );
    const variable = (body: string, name: string) =>
      body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

    it('un bloque por paleta, ni más ni menos, con su semilla', () => {
      expect([...blocks.keys()].sort()).toEqual([...THEME_PALETTES].sort());
      for (const palette of THEME_PALETTES) {
        expect(
          variable(blocks.get(palette) as string, 'seed')?.toUpperCase(),
        ).toBe(THEME_PALETTE_SEEDS[palette]);
      }
    });

    it(':root (sin paleta) es la paleta por defecto', () => {
      const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] as string;
      const fallback = blocks.get(DEFAULT_THEME_PALETTE) as string;
      for (const name of [
        'seed',
        'primary',
        'primary-strong',
        'primary-soft',
      ]) {
        expect(variable(root, name)).toBe(variable(fallback, name));
      }
    });
  });
});
