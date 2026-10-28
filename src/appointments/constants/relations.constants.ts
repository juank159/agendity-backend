/**
 * Relaciones de una cita. Los servicios se cargan por sus líneas con precio
 * (2.29: `serviceLines.service`); `Appointment.exposeServices` arma `services`.
 * (Los grupos `full` y `minimal` no tenían uso y se retiraron en 2.29.)
 */
export const RELATIONS = {
  CLIENT: 'client',
  PROFESSIONAL: 'professional',
  SERVICE_LINES: 'serviceLines',
  SERVICES: 'serviceLines.service',
};

export const RELATION_GROUPS = {
  default: [
    RELATIONS.CLIENT,
    RELATIONS.PROFESSIONAL,
    RELATIONS.SERVICE_LINES,
    RELATIONS.SERVICES,
  ],
};
