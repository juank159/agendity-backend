import { Transform, TransformFnParams } from 'class-transformer';

/**
 * Con `enableImplicitConversion` (ValidationPipe global y `/sync/push`), un
 * campo `boolean` convierte CUALQUIER valor con `Boolean(...)`: `"false"`,
 * `"no"` o `{}` llegan como `true`. Este decorador devuelve el valor ORIGINAL
 * de la petición, y `@IsBoolean()` rechaza todo lo que no sea `true`/`false`
 * de JSON. **Obligatorio en todo booleano de entrada**: lo vigila
 * `raw-boolean.decorator.spec.ts`. En la query (texto), usar
 * `ParseBoolPipe` (solo `"true"`/`"false"`).
 */
export const RAW_BOOLEAN_TRANSFORM = ({ obj, key }: TransformFnParams) =>
  obj?.[key];

export function RawBoolean(): PropertyDecorator {
  return Transform(RAW_BOOLEAN_TRANSFORM);
}
