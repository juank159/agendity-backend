/**
 * Página del link de consentimiento de WhatsApp (11.06). Sin framework: lee el
 * token de la URL, pide sus datos a `/api/public/consent/:token` y, si la
 * persona acepta, llama a `…/accept`. "No, gracias" no llama a nada.
 */
import { consentMessage, stateFromResponse, tokenFromPath } from './consent-core.mjs';

const $ = (id) => document.getElementById(id);
const token = tokenFromPath(location.pathname);
const API = `/api/public/consent/${encodeURIComponent(token)}`;
let businessName = 'El negocio';

async function call(path = '', options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function finish(state) {
  $('ask').hidden = true;
  const isError = ['invalid', 'expired', 'used', 'rate', 'error'].includes(state);
  $('error').hidden = !isError;
  $('error').textContent = isError ? consentMessage(state, businessName) : '';
  $('status').textContent = isError ? '' : consentMessage(state, businessName);
  $('app').setAttribute('aria-busy', 'false');
}

async function load() {
  if (!token) return finish('invalid');
  const { status, body } = await call().catch(() => ({ status: 0 }));
  const state = stateFromResponse(status, body);
  if (body?.business_name) businessName = body.business_name;
  $('business-name').textContent = businessName;
  if (state !== 'valid') return finish(state);

  $('greeting').textContent = body.client_name ? `Hola, ${body.client_name}` : 'Hola';
  $('ask-business').textContent = businessName;
  const list = $('purposes');
  list.replaceChildren(
    ...body.purposes.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }),
  );
  $('ask').hidden = false;
  $('app').setAttribute('aria-busy', 'false');
}

$('accept').addEventListener('click', async () => {
  $('accept').disabled = true;
  $('decline').disabled = true;
  $('status').textContent = 'Guardando…';
  const { status, body } = await call('/accept', { method: 'POST' }).catch(() => ({
    status: 0,
  }));
  finish(stateFromResponse(status, body));
});

$('decline').addEventListener('click', () => finish('declined'));

load();
