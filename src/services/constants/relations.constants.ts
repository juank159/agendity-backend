// src/services/constants/relations.constants.ts
export const RELATIONS = {
  CATEGORY: 'category',
  OWNER: 'owner',
  USER_SERVICES: 'userServices',
};

export const RELATION_GROUPS = {
  default: [RELATIONS.CATEGORY] as string[],
  full: [
    RELATIONS.CATEGORY,
    RELATIONS.OWNER,
    RELATIONS.USER_SERVICES,
  ] as string[],
  minimal: [RELATIONS.CATEGORY] as string[],
};
