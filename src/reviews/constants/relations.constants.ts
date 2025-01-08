export const RELATIONS = {
  appointment: true,
  client: true,
  professional: true,
};

export const RELATION_GROUPS = {
  default: {
    appointment: true,
    client: true,
    professional: true,
  },
  minimal: {
    appointment: true,
  },
} as const;
