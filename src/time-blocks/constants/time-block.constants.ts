export const TIME_BLOCK_RELATIONS = {
  USER: 'user',
  APPOINTMENT: 'appointment',
} as const;

export const ERROR_MESSAGES = {
  INVALID_DATE_RANGE: 'La fecha de inicio debe ser anterior a la fecha de fin',
  UNAVAILABLE_SCHEDULE: 'El horario solicitado no está disponible',
  NOT_FOUND: (id: string) => `Bloque de tiempo con ID ${id} no encontrado`,
} as const;
