export const ERROR_MESSAGES = {
    UNIQUE_VIOLATION: (field: string) => `El ${field} ya existe en la base de datos`,
    FOREIGN_KEY_VIOLATION: 'El recurso relacionado no existe',
    NOT_FOUND: (resource: string) => `El ${resource} solicitado no existe`,
    INVALID_FORMAT: 'Formato inválido para el tipo de dato',
    INTERNAL_SERVER: 'Ha ocurrido un error interno en el servidor',
  } as const;