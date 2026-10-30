import { INestApplication } from '@nestjs/common';
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

export function setupBookingPage(app: INestApplication): void {
  const indexFile = join(BOOKING_PAGE_DIR, 'index.html');
  if (!existsSync(indexFile)) return;
  const express = app as NestExpressApplication;

  express.useStaticAssets(BOOKING_PAGE_DIR, {
    prefix: '/reservar/_/',
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
  http.get('/reservar', sendIndex);
  http.get('/reservar/:slug', sendIndex);
}
