import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Service } from '../../services/entities/service.entity';
import { Appointment } from './appointment.entity';

/**
 * Un servicio dentro de una cita, con el precio cobrado (2.29). Tabla
 * `appointment_services` (antes la tabla puente de un `@ManyToMany`): mismas
 * claves, índices y FK, más `price`, la foto del precio del servicio al
 * agendarlo. Cambiar después el precio del servicio no toca las citas ya
 * creadas. Las reglas de precio viven en `appointment-pricing.ts`.
 */
@Entity('appointment_services')
export class AppointmentServiceLine {
  @PrimaryColumn('uuid', { name: 'appointment_id' })
  @Index()
  appointmentId: string;

  @PrimaryColumn('uuid', { name: 'service_id' })
  @Index()
  serviceId: string;

  /** Precio del servicio en esta cita (`numeric` llega como string). */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: string;

  @ManyToOne(() => Appointment, (appointment) => appointment.serviceLines, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;

  @ManyToOne(() => Service)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
