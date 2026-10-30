/**
 * Tarea 9.02: la página de reservas se sirve en `/reservar/:slug` (fuera de
 * `/api`), siempre el mismo `index.html`, con cabeceras estrictas y sin
 * scripts inline ni de terceros. Solo lectura.
 */
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { BOOKING_PAGE_CSP } from '../src/web/booking-page';

describe('Página de reservas 9.02 (e2e)', () => {
  let http: E2EHttp;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ http, close } = await createE2EApp());
  }, E2E_BOOT_TIMEOUT_MS);

  afterAll(async () => close());

  const expectSecurityHeaders = (res: any) => {
    expect(res.headers['content-security-policy']).toBe(BOOKING_PAGE_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  };

  it('/reservar/<slug> (exista o no) sirve el mismo index.html con CSP estricta', async () => {
    const a = await http.get('/reservar/estudio-cejas');
    const b = await http.get('/reservar/otro-negocio');
    for (const res of [a, b]) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expectSecurityHeaders(res);
    }
    expect(a.text).toBe(b.text);
    expect(a.text).toContain('<html lang="es">');
    expect(a.text).toContain('src="/reservar/_/app.mjs"');
    // Sin scripts inline, sin estilos inline y sin terceros.
    expect(a.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(a.text).not.toMatch(/\sstyle=/);
    expect(a.text).not.toMatch(/(src|href)="https?:/);
    expect(BOOKING_PAGE_CSP).toContain("script-src 'self'");
    expect(BOOKING_PAGE_CSP).not.toContain('unsafe-inline');
  });

  it('archivos estáticos en /reservar/_/: módulos como JavaScript, CSS, y 404 si no existen', async () => {
    const js = await http.get('/reservar/_/app.mjs');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/text\/javascript/);
    expectSecurityHeaders(js);
    const core = await http.get('/reservar/_/booking-core.mjs');
    expect(core.status).toBe(200);
    const css = await http.get('/reservar/_/styles.css');
    expect(css.headers['content-type']).toMatch(/text\/css/);
    const missing = await http.get('/reservar/_/nada.js');
    expect(missing.status).toBe(404);
  });

  it('no toca la API: /api sigue con su guard (401 sin sesión)', async () => {
    const res = await http.get('/api/settings');
    expect(res.status).toBe(401);
  });
});
