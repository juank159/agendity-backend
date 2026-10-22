/**
 * Tarea 1.06: todo error HTTP sale con el formato de ARQUITECTURA.md §3
 * `{ statusCode, code, message: string, details?: string[] }`.
 *
 * Sin modificar datos: el 409 de negocio (email ya registrado) se corta antes de
 * crear nada; el 500 se simula haciendo fallar un método de lectura.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CategoriesService } from '../src/categories/categories.service';
import { User } from '../src/users/entities/user.entity';
import { E2EHttp, createE2EApp } from './utils/create-e2e-app';
import { findDevOwnerAndEmployee, signToken } from './utils/dev-fixtures';

function expectContract(
  body: Record<string, unknown>,
  status: number,
  code: string,
) {
  expect(body.statusCode).toBe(status);
  expect(body.code).toBe(code);
  expect(typeof body.message).toBe('string');
  expect((body.message as string).length).toBeGreaterThan(0);
  const allowed = new Set(['statusCode', 'code', 'message', 'details']);
  expect(Object.keys(body).filter((k) => !allowed.has(k))).toEqual([]);
}

describe('Formato de errores (e2e)', () => {
  let app: INestApplication;
  let http: E2EHttp;
  let close: () => Promise<void>;
  let owner: User;
  let ownerToken: string;

  beforeAll(async () => {
    ({ app, http, close } = await createE2EApp());
    ({ owner } = await findDevOwnerAndEmployee(app.get(DataSource)));
    ownerToken = signToken(owner, ['Owner']);
  }, 60000);

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => close?.());

  it('400 de validación con details', async () => {
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'no-es-email' });
    expectContract(res.body, 400, 'VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(1);
    expect(res.body.message).toBe(res.body.details.join('\n'));
  });

  it('400 por propiedad no permitida también es VALIDATION_ERROR', async () => {
    const res = await http
      .patch(`/api/users/${owner.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ password: 'x' });
    expectContract(res.body, 400, 'VALIDATION_ERROR');
  });

  it('401 sin token', async () => {
    const res = await http.get('/api/services');
    expectContract(res.body, 401, 'UNAUTHORIZED');
    expect(res.body.message).toBe('No autorizado. Inicia sesión de nuevo.');
  });

  it('401 de negocio conserva su texto ("Credenciales inválidas")', async () => {
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'nadie@e2e.example', password: 'x' });
    expectContract(res.body, 401, 'UNAUTHORIZED');
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  it('403 por rol', async () => {
    const res = await http
      .get('/api/roles')
      .set('Authorization', `Bearer ${ownerToken}`);
    expectContract(res.body, 403, 'FORBIDDEN');
  });

  it('404 de ruta inexistente y de recurso ajeno', async () => {
    const route = await http.get('/api/no-existe');
    expectContract(route.body, 404, 'NOT_FOUND');
    expect(route.body.message).toBe('Recurso no encontrado');

    const res = await http
      .get('/api/users/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${ownerToken}`);
    expectContract(res.body, 404, 'NOT_FOUND');
  });

  it('409 de negocio con code: email ya registrado (texto que compara la app)', async () => {
    // createOwner valida el duplicado antes de crear nada: no escribe.
    const res = await http.post('/api/auth/register/owner').send({
      name: 'Duplicado',
      lastname: 'Prueba',
      email: owner.email,
      phone: '3000000000',
      password: 'Clave@Segura123',
    });
    expectContract(res.body, 409, 'DUPLICATE_EMAIL');
    expect(res.body.message).toBe(
      `Ya existe un usuario con el email: ${owner.email}`,
    );
  });

  it('500 sin stack ni mensaje interno', async () => {
    jest
      .spyOn(app.get(CategoriesService), 'findAll')
      .mockRejectedValue(new Error('detalle interno: SELECT * FROM users'));
    const res = await http
      .get('/api/categories')
      .set('Authorization', `Bearer ${ownerToken}`);
    expectContract(res.body, 500, 'INTERNAL_ERROR');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('detalle interno');
    expect(raw).not.toContain('stack');
  });
});
