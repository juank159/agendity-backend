/**
 * 11.06: link de consentimiento de WhatsApp por cliente. Escribe: solo contra
 * una copia (`E2E_WRITABLE_DB=<copia> DB_NAME=<copia>`), con dos negocios
 * nuevos.
 */
import { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  E2EHttp,
  createE2EApp,
  E2E_BOOT_TIMEOUT_MS,
} from './utils/create-e2e-app';
import { signToken } from './utils/dev-fixtures';
import { assertWritableDatabase, describeWritable } from './utils/writable-db';
import { consentLinkSecret, signConsentToken } from 'src/consent/consent-token';
import { BOOKING_PAGE_CSP } from 'src/web/booking-page';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const BASE_URL = 'https://agendity.test';

describeWritable(
  'Link de consentimiento de WhatsApp, 11.06 (e2e, escribe en copia)',
  () => {
    let app: INestApplication;
    let http: E2EHttp;
    let close: () => Promise<void>;
    let ds: DataSource;
    const run = randomUUID().slice(0, 8);
    const env = { ...process.env };
    let seq = 0;
    const phone = () => `3${String(Date.now() + ++seq).slice(-9)}`;
    const a = { token: '', id: '' };
    const b = { token: '', id: '' };
    let employeeToken = '';

    async function register(n: number) {
      const res = await http.post('/api/auth/register/owner').send({
        name: 'Dueña',
        lastname: 'Consentimiento',
        email: `consent-${n}-${run}@example.com`,
        phone: phone(),
        password: 'Secreta1!',
        business_name: `Salón Consentido ${n} ${run}`,
      });
      expect(res.status).toBe(201);
      return {
        token: res.body.token as string,
        id: res.body.user.id as string,
      };
    }

    async function client(
      t: { token: string },
      over: Record<string, unknown> = {},
    ) {
      const res = await http
        .post('/api/clients')
        .set(auth(t.token))
        .send({ name: 'Ana', lastname: 'Cliente', phone: phone(), ...over });
      expect(res.status).toBe(201);
      return res.body.id as string;
    }

    async function link(clientId: string, token = a.token) {
      const res = await http
        .post(`/api/clients/${clientId}/consent-link`)
        .set(auth(token));
      expect(res.status).toBe(201);
      return res.body as { url: string; path: string; expires_at: string };
    }

    const tokenOf = (path: string) => path.replace('/consentimiento/', '');
    const view = (token: string) => http.get(`/api/public/consent/${token}`);
    const accept = (token: string) =>
      http
        .post(`/api/public/consent/${token}/accept`)
        .set('User-Agent', 'Prueba e2e/1.0');
    const consentOf = async (id: string) =>
      (
        await ds.query(
          `SELECT whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_out_at,
                whatsapp_opt_in_source, sync_version
           FROM clients WHERE id = $1`,
          [id],
        )
      )[0];

    beforeAll(async () => {
      process.env.PUBLIC_BASE_URL = BASE_URL;
      ({ app, http, close } = await createE2EApp());
      ds = app.get(DataSource);
      await assertWritableDatabase(ds);
      jest.spyOn(app.get(EventEmitter2), 'emit').mockImplementation(() => true);
      Object.assign(a, await register(1));
      Object.assign(b, await register(2));
      const emp = await http
        .post('/api/auth/register/employee')
        .set(auth(a.token))
        .send({
          name: 'Laura',
          lastname: 'Empleada',
          email: `consent-emp-${run}@example.com`,
          phone: phone(),
          password: 'Secreta1!',
        });
      expect(emp.status).toBe(201);
      await ds.query(
        `UPDATE users SET is_email_verified = true, "isActive" = true WHERE id = $1`,
        [emp.body.user.id],
      );
      employeeToken = signToken(
        {
          id: emp.body.user.id,
          name: 'Laura',
          email: `consent-emp-${run}@example.com`,
          owner: { id: a.id },
        },
        ['Employee'],
      );
    }, E2E_BOOT_TIMEOUT_MS);

    afterAll(async () => {
      process.env = env;
      jest.restoreAllMocks();
      await close();
    });

    it('crear el link: Owner y Employee del negocio; cliente de otro negocio → 404; 30 días', async () => {
      const c = await client(a);
      const before = Date.now();
      const res = await link(c);
      expect(res.url).toBe(`${BASE_URL}${res.path}`);
      expect(res.path).toMatch(/^\/consentimiento\/v1\.[\w-]+\.[\w-]+$/);
      expect(res).toMatchObject({ already_opted_in: false });
      const days = (new Date(res.expires_at).getTime() - before) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);

      expect(
        (
          await http
            .post(`/api/clients/${c}/consent-link`)
            .set(auth(employeeToken))
        ).status,
      ).toBe(201);
      const other = await http
        .post(`/api/clients/${c}/consent-link`)
        .set(auth(b.token));
      expect([other.status, other.body.code]).toEqual([404, 'NOT_FOUND']);
      expect((await http.post(`/api/clients/${c}/consent-link`)).status).toBe(
        401,
      );
    });

    it('página pública: mismo HTML sin framework y la misma CSP que /reservar', async () => {
      const c = await client(a);
      const { path } = await link(c);
      const page = await http.get(path);
      expect(page.status).toBe(200);
      expect(page.headers['content-security-policy']).toBe(BOOKING_PAGE_CSP);
      expect(page.text).toContain('/consentimiento/_/consent.mjs');
      const js = await http.get('/consentimiento/_/consent.mjs');
      expect(js.status).toBe(200);
      expect(js.headers['content-type']).toMatch(/javascript/);
    });

    it('aceptar: consentimiento con origen LINK, prueba (IP y navegador), sincroniza; de un solo uso', async () => {
      const c = await client(a, { name: 'Marta' });
      const token = tokenOf((await link(c)).path);
      const shown = await view(token);
      expect(shown.status).toBe(200);
      expect(shown.body).toMatchObject({
        state: 'valid',
        business_name: `Salón Consentido 1 ${run}`,
        client_name: 'Marta',
      });
      expect(shown.body.purposes.join(' ')).toMatch(
        /citas.*mantenimiento.*cumpleaños/s,
      );
      // Nada interno en la respuesta pública.
      expect(JSON.stringify(shown.body)).not.toContain(c);
      expect(JSON.stringify(shown.body)).not.toContain(a.id);

      const before = await consentOf(c);
      const ok = await accept(token);
      expect([ok.status, ok.body.state]).toEqual([200, 'accepted']);
      const after = await consentOf(c);
      expect(after).toMatchObject({
        whatsapp_opt_in: true,
        whatsapp_opt_out_at: null,
        whatsapp_opt_in_source: 'LINK',
      });
      expect(after.whatsapp_opt_in_at).not.toBeNull();
      expect(BigInt(after.sync_version)).toBeGreaterThan(
        BigInt(before.sync_version),
      );
      const [evidence] = await ds.query(
        `SELECT accepted_at, accepted_ip, accepted_user_agent FROM whatsapp_consent_links
        WHERE client_id = $1`,
        [c],
      );
      expect(evidence.accepted_at).not.toBeNull();
      expect(evidence.accepted_ip).toBeTruthy();
      expect(evidence.accepted_user_agent).toBe('Prueba e2e/1.0');

      // Ya usado: la página lo dice y aceptar otra vez → 409 sin cambiar nada.
      expect((await view(token)).body.state).toBe('used');
      const again = await accept(token);
      expect([again.status, again.body.code, again.body.message]).toEqual([
        409,
        'CONFLICT',
        'Este link ya se usó',
      ]);
      expect(await consentOf(c)).toEqual(after);
    });

    it('vencido: la página lo dice y aceptar → 409', async () => {
      const c = await client(a);
      const token = tokenOf((await link(c)).path);
      await ds.query(
        `UPDATE whatsapp_consent_links SET expires_at = now() - interval '1 minute'
        WHERE client_id = $1`,
        [c],
      );
      expect((await view(token)).body.state).toBe('expired');
      const res = await accept(token);
      expect([res.status, res.body.code]).toEqual([409, 'CONFLICT']);
      expect(res.body.message).toMatch(/venció/);
      expect((await consentOf(c)).whatsapp_opt_in).toBe(false);
    });

    it('firma inválida, token de otro negocio o link inexistente → 404 sin cambiar nada', async () => {
      const c = await client(a);
      const token = tokenOf((await link(c)).path);
      const [jti] = await ds.query(
        'SELECT id FROM whatsapp_consent_links WHERE client_id = $1',
        [c],
      );
      const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
      const secret = consentLinkSecret();
      const expiresAt = new Date(Date.now() + 86_400_000);
      // Bien firmado pero diciendo que el cliente es de B.
      const otherBusiness = signConsentToken(
        { jti: jti.id, clientId: c, tenantId: b.id, expiresAt },
        secret,
      );
      // Firmado con otro secreto.
      const otherSecret = signConsentToken(
        { jti: jti.id, clientId: c, tenantId: a.id, expiresAt },
        'otro-secreto',
      );
      // Firmado bien pero de un link que no existe.
      const unknown = signConsentToken(
        { jti: randomUUID(), clientId: c, tenantId: a.id, expiresAt },
        secret,
      );
      for (const bad of [
        tampered,
        otherBusiness,
        otherSecret,
        unknown,
        'basura',
        'v1.x.y',
      ]) {
        expect((await view(bad)).status).toBe(404);
        const res = await accept(bad);
        expect([res.status, res.body.code]).toEqual([404, 'NOT_FOUND']);
      }
      expect((await consentOf(c)).whatsapp_opt_in).toBe(false);
    });

    it('origen APP: marcado por el negocio en la app', async () => {
      const c = await client(a, { whatsapp_opt_in: true });
      expect(await consentOf(c)).toMatchObject({
        whatsapp_opt_in: true,
        whatsapp_opt_in_source: 'APP',
      });
      const d = await client(a);
      await http
        .patch(`/api/clients/${d}`)
        .set(auth(a.token))
        .send({ whatsapp_opt_in: true });
      expect((await consentOf(d)).whatsapp_opt_in_source).toBe('APP');
    });
  },
);
