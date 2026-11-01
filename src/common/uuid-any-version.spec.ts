import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ParseUUIDPipe } from '@nestjs/common';
import { AvailableSlotsQueryDto } from 'src/appointments/dto/available-slots-query.dto';
import { CreateAppointmentDto } from 'src/appointments/dto/create-appointment.dto';
import { UpdateAppointmentDto } from 'src/appointments/dto/update-appointment.dto';
import { CreateEmployeeDto } from 'src/auth/dto/create-employee.dto';
import { CategoriesService } from 'src/categories/categories.service';

/**
 * 7.05a: el servidor acepta ids de CUALQUIER versión de UUID (diseño de sync
 * §1). La app genera v7 sin conexión; antes una regex propia (v1-v5) y tres
 * `@IsUUID('4')` los rechazaban, y un negocio que creaba categorías desde la
 * app no podía crear servicios en ellas.
 */
const V1 = 'c232ab00-9414-11ec-b3c8-9f6bdeced846';
const V4 = 'c0000000-0000-4000-8000-000000000001';
const V7 = '01890a5d-ac96-774b-bcce-b302099a8057';
const V7B = '01890a5d-ac96-7a4b-9cce-b302099a8058';

async function errorsOn(
  cls: new () => object,
  body: object,
  property: string,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body) as object);
  return errors
    .filter((e) => e.property === property)
    .flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('UUID de cualquier versión (7.05a)', () => {
  describe('DTOs', () => {
    it('cita: service_ids v7 al crear y al editar', async () => {
      expect(
        await errorsOn(
          CreateAppointmentDto,
          { service_ids: [V7, V4] },
          'service_ids',
        ),
      ).toEqual([]);
      expect(
        await errorsOn(
          UpdateAppointmentDto,
          { service_ids: [V7] },
          'service_ids',
        ),
      ).toEqual([]);
    });

    it('horas libres: service_ids v7 (lista y separada por comas)', async () => {
      expect(
        await errorsOn(
          AvailableSlotsQueryDto,
          { service_ids: [V7, V7B] },
          'service_ids',
        ),
      ).toEqual([]);
      expect(
        await errorsOn(
          AvailableSlotsQueryDto,
          { service_ids: `${V7},${V1}` },
          'service_ids',
        ),
      ).toEqual([]);
    });

    it('empleada nueva: serviceIds v7', async () => {
      expect(
        await errorsOn(CreateEmployeeDto, { serviceIds: [V7] }, 'serviceIds'),
      ).toEqual([]);
    });

    it('sigue rechazando lo que no es un UUID', async () => {
      expect(
        await errorsOn(
          CreateAppointmentDto,
          { service_ids: ['no-es-uuid'] },
          'service_ids',
        ),
      ).toContain('isUuid');
      expect(
        await errorsOn(
          AvailableSlotsQueryDto,
          { service_ids: 'abc' },
          'service_ids',
        ),
      ).toContain('isUuid');
      expect(
        await errorsOn(CreateEmployeeDto, { serviceIds: ['x'] }, 'serviceIds'),
      ).toContain('isUuid');
    });

    it('ParseUUIDPipe sin versión acepta v7', async () => {
      await expect(
        new ParseUUIDPipe().transform(V7, { type: 'param' }),
      ).resolves.toBe(V7);
    });
  });

  describe('CategoriesService.findOne: un UUID se busca por id, lo demás por nombre', () => {
    function build() {
      const qb: any = {
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        leftJoinAndSelect: jest.fn(() => qb),
        getOne: jest.fn(async () => ({ id: V7 })),
      };
      const categories = { createQueryBuilder: jest.fn(() => qb) };
      return {
        service: new CategoriesService(categories as any, {} as any),
        qb,
      };
    }

    it.each([
      ['v1', V1],
      ['v4', V4],
      ['v7', V7],
      ['v7 en mayúsculas', V7.toUpperCase()],
    ])('%s → por id', async (_label, id) => {
      const { service, qb } = build();
      await service.findOne(id, 'tenant');
      expect(qb.andWhere).toHaveBeenCalledWith('category.id = :id', { id });
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
    });

    it('un nombre → por nombre', async () => {
      const { service, qb } = build();
      await service.findOne('Cortes', 'tenant');
      expect(qb.andWhere).toHaveBeenCalledWith(
        'LOWER(category.name) = LOWER(:name)',
        { name: 'Cortes' },
      );
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
    });
  });

  it('ningún archivo de src/ ata la validación de UUID a una versión', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'migrations') walk(path);
        } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
          files.push(path);
        }
      }
    };
    walk(root);

    const forbidden = [
      // @IsUUID('4') / isUUID(x, 4) / ParseUUIDPipe({ version: '4' })
      /\b[iI]sUUID\(\s*['"]?[1-8]['"]?\s*[,)]/,
      /\b[iI]sUUID\([^)]*,\s*['"]?[1-8]['"]?\s*[,)]/,
      /ParseUUIDPipe\(\s*\{[^}]*version/,
      // regex propias con la versión fijada en el tercer grupo
      /\{4\}-\[[1-8]-[1-8]\]/,
      /\{4\}-[1-8]\[0-9a-f/i,
    ];
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden
        .filter((re) => re.test(text))
        .map((re) => `${file.slice(root.length + 1)} ${re}`);
    });
    expect(offenders).toEqual([]);
  });
});
