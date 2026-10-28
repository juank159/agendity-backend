import { AsyncLocalStorage } from 'async_hooks';

/**
 * Zona horaria de la petición HTTP en curso (6.02, D-15).
 *
 * La salida JSON la arma Express con un `json replacer` global
 * (`businessJsonReplacer`), que no recibe la petición: por eso la zona del
 * tenant viaja en un `AsyncLocalStorage`. `requestTimeZoneMiddleware` abre el
 * contexto al entrar la petición y `TenantTimeZoneInterceptor` (tras los
 * guards, cuando ya se conoce el tenant) guarda la zona. Solo lo usa la
 * serialización: la lógica de negocio recibe la zona explícita.
 */
interface RequestTimeZoneStore {
  timeZone?: string;
}

const storage = new AsyncLocalStorage<RequestTimeZoneStore>();

/** Middleware de Express: un contexto vacío por petición. */
export function requestTimeZoneMiddleware(
  _req: unknown,
  _res: unknown,
  next: () => void,
): void {
  storage.run({}, next);
}

/** Fija la zona de la petición en curso (no hace nada fuera de una petición). */
export function setRequestTimeZone(timeZone: string): void {
  const store = storage.getStore();
  if (store) store.timeZone = timeZone;
}

/** Zona del tenant de la petición en curso, o `undefined` (sin sesión, fuera de HTTP). */
export function requestTimeZone(): string | undefined {
  return storage.getStore()?.timeZone;
}

/** Para tests: ejecuta `fn` con la zona fijada. */
export function runWithRequestTimeZone<T>(
  timeZone: string | undefined,
  fn: () => T,
): T {
  return storage.run({ timeZone }, fn);
}
