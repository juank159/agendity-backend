export const RELATIONS = {
  CLIENT: 'client',
  PROFESSIONAL: 'professional',
  SERVICES: 'services', // Cambiado de SERVICE a SERVICES
  CATEGORY: 'services.category', // Actualizado para reflejar la nueva estructura
};

export const RELATION_GROUPS = {
  default: [
    RELATIONS.CLIENT,
    RELATIONS.PROFESSIONAL,
    RELATIONS.SERVICES, // Actualizado a SERVICES
  ],
  full: [
    RELATIONS.CLIENT,
    RELATIONS.PROFESSIONAL,
    RELATIONS.SERVICES, // Actualizado a SERVICES
    RELATIONS.CATEGORY,
  ],
  minimal: [
    RELATIONS.PROFESSIONAL,
    RELATIONS.SERVICES, // Actualizado a SERVICES
  ],
};
