// Lógica de la página de consentimiento de WhatsApp (11.06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consentMessage,
  stateFromResponse,
  tokenFromPath,
} from '../../public/consentimiento/consent-core.mjs';

test('token de la URL', () => {
  assert.equal(tokenFromPath('/consentimiento/v1.abc.def'), 'v1.abc.def');
  assert.equal(tokenFromPath('/consentimiento/'), '');
  assert.equal(tokenFromPath('/consentimiento'), '');
  assert.equal(tokenFromPath('/consentimiento/%E0%A4%A'), '');
});

test('estado según la respuesta: inválido, vencido, usado, válido y aceptado', () => {
  assert.equal(stateFromResponse(404, null), 'invalid');
  assert.equal(stateFromResponse(409, { message: 'Este link ya se usó' }), 'used');
  assert.equal(stateFromResponse(409, { message: 'Este link venció.' }), 'expired');
  assert.equal(stateFromResponse(200, { state: 'expired' }), 'expired');
  assert.equal(stateFromResponse(200, { state: 'valid' }), 'valid');
  assert.equal(stateFromResponse(200, { state: 'accepted' }), 'accepted');
  assert.equal(stateFromResponse(429, null), 'rate');
  assert.equal(stateFromResponse(0, null), 'error');
});

test('mensajes claros: la baja con BAJA y "No, gracias" no cambia nada', () => {
  assert.match(consentMessage('accepted', 'Salón Sol'), /Salón Sol.*BAJA/);
  assert.match(consentMessage('declined'), /no cambiamos nada/);
  assert.match(consentMessage('expired'), /venció/);
  assert.match(consentMessage('used'), /ya se usó/);
});
