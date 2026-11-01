import { INestApplication, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Página web de reservas (9.02, D-17): `GET /reservar/:slug`, fuera de `/api`
 * y en el mismo origen que la API (sin CORS ni otro hosting). HTML + CSS + JS
 * sin framework ni build, en `backend/public/reservar/`.
 *
 * - `/reservar/_/…`: los archivos estáticos (el `_` no puede ser parte de un
 *   slug, así que no choca con ninguno).
 * - `/reservar` y `/reservar/:slug`: siempre el mismo `index.html`; el JS lee
 *   el slug de la URL y pide los datos a `/api/public/businesses/:slug`.
 *
 * Sin dependencias nuevas: `useStaticAssets` de `@nestjs/platform-express`
 * (ya instalado) y una ruta de Express. Cabeceras estrictas
 * (`BOOKING_PAGE_HEADERS`): CSP sin scripts ni estilos inline y nada de
 * terceros. En el despliegue (Fase D) la carpeta `public/` va con el backend.
 */
export const BOOKING_PAGE_DIR = join(
  __dirname,
  '..',
  '..',
  'public',
  'reservar',
);

export const BOOKING_PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // Fotos de los profesionales (Cloudinary u otra URL https).
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const BOOKING_PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': BOOKING_PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

type HeaderTarget = { setHeader(name: string, value: string): unknown };

function setSecurityHeaders(res: HeaderTarget): void {
  for (const [name, value] of Object.entries(BOOKING_PAGE_HEADERS)) {
    res.setHeader(name, value);
  }
}

/**
 * Sirve una página pública sin framework (HTML + JS + CSS de `public/<dir>`)
 * con las cabeceras estrictas: estáticos en `<route>/_/…` y el `index.html`
 * en `<route>` y `<route>/:param`. La usan `/reservar` (9.02) y
 * `/consentimiento` (11.06).
 */
export function servePublicPage(
  app: INestApplication,
  { route, dir, name }: { route: string; dir: string; name: string },
): void {
  const indexFile = join(dir, 'index.html');
  if (!existsSync(indexFile)) {
    // D.02: en producción `public/` debe ir con el backend (si no, la
    // página da 404).
    new Logger(name).error(
      `No se encontró ${indexFile}: ${route} no estará disponible. Despliega la carpeta public/ junto al backend.`,
    );
    return;
  }
  const express = app as NestExpressApplication;

  express.useStaticAssets(dir, {
    prefix: `${route}/_/`,
    index: false,
    setHeaders: (res, path) => {
      setSecurityHeaders(res);
      // `.mjs` como JavaScript (los módulos del navegador lo exigen).
      if (path.endsWith('.mjs')) {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      }
      res.setHeader('Cache-Control', 'no-cache');
    },
  });

  const sendIndex = (
    _req: unknown,
    res: HeaderTarget & { sendFile(path: string): void },
  ) => {
    setSecurityHeaders(res);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  };
  const http = express.getHttpAdapter().getInstance();
  http.get(route, sendIndex);
  http.get(`${route}/:param`, sendIndex);
}

export function setupBookingPage(app: INestApplication): void {
  servePublicPage(app, {
    route: '/reservar',
    dir: BOOKING_PAGE_DIR,
    name: 'BookingPage',
  });
}

/** Página del link de consentimiento de WhatsApp (11.06): `/consentimiento/:token`. */
export const CONSENT_PAGE_DIR = join(
  __dirname,
  '..',
  '..',
  'public',
  'consentimiento',
);

export function setupConsentPage(app: INestApplication): void {
  servePublicPage(app, {
    route: '/consentimiento',
    dir: CONSENT_PAGE_DIR,
    name: 'ConsentPage',
  });
}
