// Paletas de la web de reservas (12.01, D-22): contraste AA del texto con el
// acento de cada paleta y el atributo `data-palette` que pone app.mjs.
// La lista de paletas y sus semillas la vigila src/settings/theme-palette.spec.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paletteAttr } from '../../public/reservar/booking-core.mjs';

const css = readFileSync(
  new URL('../../public/reservar/styles.css', import.meta.url),
  'utf8',
);

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) =>
    channel(parseInt(hex.slice(i, i + 2), 16)),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const variable = (body, name) =>
  body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

const root = css.match(/:root\s*\{([^}]*)\}/)[1];
const palettes = [
  ...css.matchAll(/:root\[data-palette='([a-z]+)'\]\s*\{([^}]*)\}/g),
].map(([, name, body]) => ({ name, body }));

test('hay seis paletas en la hoja de estilos', () => {
  assert.equal(palettes.length, 6);
});

test('contraste AA (>= 4.5:1) del acento de cada paleta', () => {
  const white = variable(root, 'primary-text');
  const bg = variable(root, 'bg');
  const surface = variable(root, 'surface');
  const text = variable(root, 'text');
  for (const { name, body } of palettes) {
    const primary = variable(body, 'primary');
    const strong = variable(body, 'primary-strong');
    const soft = variable(body, 'primary-soft');
    const checks = {
      'texto blanco sobre el acento (botón, chip, día, hora)': [white, primary],
      'texto blanco sobre el fin del degradado del encabezado': [white, strong],
      'acento como texto sobre la tarjeta': [primary, surface],
      'acento como texto sobre el fondo (eyebrow, enlaces)': [primary, bg],
      'acento sobre el servicio elegido': [primary, soft],
      'texto sobre el servicio elegido': [text, soft],
    };
    for (const [what, [a, b]] of Object.entries(checks)) {
      const ratio = contrast(a, b);
      assert.ok(ratio >= 4.5, `${name}: ${what} = ${ratio.toFixed(2)} (< 4.5)`);
    }
  }
});

test('sin estilos inline: el acento entra por variables CSS y data-palette', () => {
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/);
  for (const name of ['primary', 'primary-strong', 'primary-soft', 'seed']) {
    assert.ok(variable(root, name), `falta --${name} en :root`);
  }
});

test('paletteAttr: solo deja pasar un nombre en minúsculas', () => {
  assert.equal(paletteAttr('rosa'), 'rosa');
  assert.equal(paletteAttr('grafito'), 'grafito');
  for (const bad of [
    null,
    undefined,
    '',
    5,
    'Rosa',
    'rosa; color: red',
    "rosa'] { }",
    'x'.repeat(21),
  ]) {
    assert.equal(paletteAttr(bad), '');
  }
});
