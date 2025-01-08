// src/payments/constants/payment-relations.constants.ts
export const RELATIONS = {
  APPOINTMENT: {
    appointment: true,
    'appointment.client': true,
    'appointment.professional': true,
  },
  MINIMAL: {
    appointment: true,
  },
} as const;
