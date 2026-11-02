/**
 * Paleta de color del negocio (12.01, D-22). ÚNICO lugar donde se definen los
 * valores: el DTO de `PATCH /settings`, la vista de ajustes, el feed de sync,
 * la API pública y el test de la web de reservas (`styles.css` debe tener un
 * bloque `[data-palette='…']` por cada una) salen de aquí.
 *
 * `null` en `business_settings.theme_palette` = sin elegir: la app y la web
 * usan `DEFAULT_THEME_PALETTE`.
 */
export const THEME_PALETTES = [
  'lavanda',
  'rosa',
  'azul',
  'turquesa',
  'coral',
  'grafito',
] as const;

export type ThemePalette = (typeof THEME_PALETTES)[number];

export const DEFAULT_THEME_PALETTE: ThemePalette = 'lavanda';

/** Semilla de cada paleta (guía de diseño §1). La app ajusta tonos con `fromSeed`. */
export const THEME_PALETTE_SEEDS: Record<ThemePalette, string> = {
  lavanda: '#7C5CFC',
  rosa: '#EC4899',
  azul: '#2563EB',
  turquesa: '#0EA5A4',
  coral: '#F97316',
  grafito: '#334155',
};

export const THEME_PALETTE_MESSAGE = `La paleta no es válida: usa una de ${THEME_PALETTES.join(', ')}`;

export function isThemePalette(value: unknown): value is ThemePalette {
  return (
    typeof value === 'string' &&
    (THEME_PALETTES as readonly string[]).includes(value)
  );
}

/** Valor guardado → el que se expone: uno desconocido (no debería) cuenta como `null`. */
export function storedThemePalette(value: unknown): ThemePalette | null {
  return isThemePalette(value) ? value : null;
}
