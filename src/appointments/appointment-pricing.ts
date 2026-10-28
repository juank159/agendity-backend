import { fromCents, toCents } from 'src/payments/payment-rules';

/**
 * Precio de los servicios de una cita (2.29). La cita guarda el precio de cada
 * servicio al agendarlo (`appointment_services.price`) y su total es la suma de
 * esos precios: cambiar el precio de un servicio no altera las citas ya
 * creadas. Al editar los servicios de una cita, los que se conservan mantienen
 * su precio y solo los nuevos toman el precio actual del catálogo.
 * Reglas puras, en centavos (`numeric` llega como string de Postgres).
 */

/** Línea de precio de un servicio en una cita. */
export interface ServicePriceLine {
  serviceId: string;
  /** Decimal con 2 cifras, como lo guarda Postgres (`"25000.00"`). */
  price: string;
}

/** Centavos → decimal con 2 cifras para una columna `numeric(10,2)`. */
export function centsToDecimal(cents: number): string {
  return fromCents(cents).toFixed(2);
}

/**
 * Líneas de la cita para `services` (en su orden). `previous` = precios ya
 * guardados por servicio (al editar): se conservan; el resto toma el precio
 * actual del servicio.
 */
export function priceLinesFor(
  services: { id: string; price: number | string }[],
  previous: ReadonlyMap<string, number | string> = new Map(),
): ServicePriceLine[] {
  return services.map((service) => ({
    serviceId: service.id,
    price: centsToDecimal(
      toCents(
        previous.has(service.id) ? previous.get(service.id) : service.price,
      ),
    ),
  }));
}

/** Total de la cita = suma de los precios guardados de sus servicios. */
export function priceLinesTotal(lines: { price: number | string }[]): number {
  return fromCents(lines.reduce((sum, line) => sum + toCents(line.price), 0));
}
