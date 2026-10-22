// src/payments/constants/payment-relations.constants.ts
// Relaciones anidadas en forma de objeto: TypeORM 0.3 no acepta claves con punto
// ('appointment.client') en este formato y lanzaba "Property ... was not found" (500).
export const RELATIONS = {
  APPOINTMENT: {
    appointment: { client: true, professional: true },
  },
  MINIMAL: {
    appointment: true,
  },
  APPOINTMENT_WITH_CUSTOM_METHOD: {
    appointment: { client: true, professional: true },
    custom_payment_method: true,
  },
};
