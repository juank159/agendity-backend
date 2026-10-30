/**
 * Slug del link público del negocio (8.00, para la Fase 9): minúsculas, sin
 * tildes, solo letras, números y guiones. "Estudio Cejas & Pestañas" →
 * "estudio-cejas-pestanas". Vacío si el nombre no tiene letras ni números.
 */
export const SLUG_MAX_LENGTH = 60;

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/** Primer slug libre: `base`, `base-2`, `base-3`… (`taken` = los que ya existen). */
export function firstFreeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
