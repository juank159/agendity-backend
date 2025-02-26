// // src/payments/constants/payment-relations.constants.ts
// export const RELATIONS = {
//   APPOINTMENT: {
//     appointment: true,
//     'appointment.client': true,
//     'appointment.professional': true,
//   },
//   MINIMAL: {
//     appointment: true,
//   },
// } as const;

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
  APPOINTMENT_WITH_CUSTOM_METHOD: {
    appointment: true,
    'appointment.client': true,
    'appointment.professional': true,
    custom_payment_method: true,
  },
};
