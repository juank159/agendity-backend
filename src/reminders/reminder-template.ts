/**
 * Plantillas de recordatorio (Fase 11.01): variables entre llaves. Una
 * variable desconocida es un error de validación (no se manda `{cliente}` en
 * crudo); una conocida sin valor queda vacía.
 */
export const TEMPLATE_VARIABLES = [
  'cliente',
  'negocio',
  'servicio',
  'fecha',
  'hora',
  'profesional',
  'link_reserva',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string | null>>;

const VARIABLE = /\{([a-z_]+)\}/g;
export const TEMPLATE_MAX_LENGTH = 1024;

/** Variables que usa la plantilla, en orden de aparición y sin repetir. */
export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VARIABLE)].map((m) => m[1]))];
}

/** Texto del error, o `null` si la plantilla vale. */
export function templateError(template: string): string | null {
  if (!template?.trim()) return 'La plantilla no puede estar vacía';
  if (template.length > TEMPLATE_MAX_LENGTH) {
    return `La plantilla admite hasta ${TEMPLATE_MAX_LENGTH} caracteres`;
  }
  const unknown = templateVariables(template).filter(
    (v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v),
  );
  return unknown.length
    ? `Variables desconocidas: ${unknown.map((v) => `{${v}}`).join(', ')}. Usa ${TEMPLATE_VARIABLES.map((v) => `{${v}}`).join(', ')}`
    : null;
}

export function renderTemplate(
  template: string,
  values: TemplateValues,
): string {
  return template
    .replace(VARIABLE, (whole, name: string) =>
      (TEMPLATE_VARIABLES as readonly string[]).includes(name)
        ? (values[name as TemplateVariable] ?? '').trim()
        : whole,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
