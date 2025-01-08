// src/appointments/constants/relations.constants.ts
export const RELATIONS = {
  CLIENT: 'client',
  PROFESSIONAL: 'professional',
  SERVICE: 'service',
  CATEGORY: 'service.category',
};

export const RELATION_GROUPS = {
  default: [RELATIONS.CLIENT, RELATIONS.PROFESSIONAL, RELATIONS.SERVICE],
  full: [
    RELATIONS.CLIENT,
    RELATIONS.PROFESSIONAL,
    RELATIONS.SERVICE,
    RELATIONS.CATEGORY,
  ],
  minimal: [RELATIONS.PROFESSIONAL, RELATIONS.SERVICE],
};
