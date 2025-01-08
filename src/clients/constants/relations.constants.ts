// src/clients/constants/relations.constants.ts
export const RELATIONS = {
  APPOINTMENTS: 'appointments',
  REVIEWS: 'reviews',
  OWNER: 'owner',
} as const;

export const RELATION_GROUPS = {
  default: [RELATIONS.APPOINTMENTS, RELATIONS.REVIEWS],
  full: [RELATIONS.APPOINTMENTS, RELATIONS.REVIEWS, RELATIONS.OWNER],
  minimal: [],
};
