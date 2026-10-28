/**
 * Tarea 1.02: ninguna respuesta HTTP contiene secretos de `User`.
 *
 * Usa usuarios reales de la BD de desarrollo en SOLO LECTURA:
 * - solo peticiones GET de lectura y el login (que no escribe);
 * - no se cambia ninguna contraseña ni código.
 */
import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { instanceToPlain } from 'class-transformer';
import { DataSource } from 'typeorm';
import { Schedule } from '../src/schedules/entities/schedule.entity';
import { USER_SECRET_FIELDS, User } from '../src/users/entities/user.entity';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
  E2E_ROUTE_SCAN_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

const SECRET_KEYS = new Set<string>(USER_SECRET_FIELDS);

/** Devuelve las rutas JSON (a.b[0].c) donde aparece alguna clave secreta. */
function findSecretKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSecretKeys(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(SECRET_KEYS.has(key) ? [`${path}.${key}`] : []),
      ...findSecretKeys(child, `${path}.${key}`),
    ]);
  }
  return [];
}

describe('Secretos de User fuera de las respuestas (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let ds: DataSource;
  let owner: User;
  let employee: User | null;
  let ownerToken: string;

  const sign = signToken;

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ds = app.get(DataSource);
    ({ owner, employee } = await findDevOwnerAndEmployee(ds));
    ownerToken = sign(owner, ['Owner']);
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await close?.();
  });

  it('las columnas secretas tienen select:false', () => {
    const columns = ds
      .getMetadata(User)
      .columns.filter((c) => SECRET_KEYS.has(c.propertyName));
    expect(columns.map((c) => c.propertyName).sort()).toEqual(
      [...SECRET_KEYS].sort(),
    );
    expect(columns.every((c) => c.isSelect === false)).toBe(true);
  });

  it('una relación que carga User (schedule.user) no trae secretos', async () => {
    const schedules = await ds
      .getRepository(Schedule)
      .find({ relations: ['user'], take: 5 });
    expect(findSecretKeys(schedules)).toEqual([]);
  });

  it('el ClassSerializerInterceptor excluye los secretos de una instancia de User', () => {
    const user = Object.assign(new User(), {
      id: 'x',
      email: 'x@e2e.local',
      password: 'hash',
      verification_code: '123456',
      verification_code_expires: new Date(),
      reset_password_code: '654321',
      reset_password_expires: new Date(),
    });
    const plain = instanceToPlain(user);
    expect(findSecretKeys(plain)).toEqual([]);
    expect(plain.email).toBe('x@e2e.local');
  });

  it('login de un usuario real: compara contra el hash de la BD y responde sin secretos', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');
    // No conocemos la contraseña real ni la cambiamos: se fuerza solo el resultado
    // de la comparación y se comprueba que recibió el hash real de la BD.
    compare.mockImplementationOnce(async () => true);

    const res = await http
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'no-es-la-clave' });

    expect(res.status).toBe(200);
    expect(compare).toHaveBeenCalledWith(
      'no-es-la-clave',
      expect.stringMatching(/^\$2[aby]\$\d{2}\$/),
    );
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.id).toBe(owner.id);
    expect(findSecretKeys(res.body)).toEqual([]);
    compare.mockRestore();
  });

  it('login de un usuario real con contraseña incorrecta responde 401 (no 500)', async () => {
    const res = await http
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'Clave-Incorrecta-e2e-1!' });
    expect(res.status).toBe(401);
  });

  it(
    'las lecturas del Owner no contienen secretos',
    async () => {
      const paths = [
        '/api/appointments',
        '/api/auth/me',
        '/api/schedules/user/{owner}',
        '/api/auth/employees?includeDeleted=true',
        '/api/auth/employees/active',
        '/api/auth/employees/deleted',
        '/api/users',
        '/api/users/{owner}',
        '/api/users/{owner}/services',
        '/api/services',
        '/api/categories',
        '/api/clients/all',
      ];
      if (employee) {
        paths.push(
          '/api/schedules/user/{employee}',
          '/api/auth/employee/{employee}',
          '/api/users/{employee}/services',
        );
      }

      const failures: string[] = [];
      for (const template of paths) {
        const url = template
          .replace('{owner}', owner.id)
          .replace('{employee}', employee?.id ?? '');
        const res = await http
          .get(url)
          .set('Authorization', `Bearer ${ownerToken}`);
        if (res.status !== 200) {
          failures.push(`${url} -> ${res.status}`);
          continue;
        }
        const leaks = findSecretKeys(res.body);
        if (leaks.length) failures.push(`${url} -> ${leaks.join(', ')}`);
      }
      expect(failures).toEqual([]);
    },
    E2E_ROUTE_SCAN_TIMEOUT_MS,
  );

  it('GET /schedules (Admin) devuelve el usuario de cada horario sin secretos', async () => {
    const res = await http
      .get('/api/schedules')
      .set('Authorization', `Bearer ${sign(owner, ['Admin'])}`);
    expect(res.status).toBe(200);
    expect(findSecretKeys(res.body)).toEqual([]);
    const withUser = (res.body as Array<{ user?: object }>).filter(
      (s) => s.user,
    );
    // Si la BD tiene horarios, la relación se carga (pero sin secretos).
    expect(withUser.length).toBe((res.body as unknown[]).length);
  });
});
