import { Transform } from 'class-transformer';

/**
 * Con `enableImplicitConversion` (ValidationPipe global), un campo `boolean`
 * convierte CUALQUIER valor con `Boolean(...)`: `"false"`, `"no"` o `{}` llegan
 * como `true`. Para campos donde eso es grave (consentimiento de WhatsApp,
 * D-21) este decorador devuelve el valor ORIGINAL de la petición, y
 * `@IsBoolean()` rechaza todo lo que no sea `true`/`false` de JSON.
 */
export function RawBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => obj?.[key]);
}
