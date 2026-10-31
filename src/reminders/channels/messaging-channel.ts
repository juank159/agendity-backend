import type { ReminderCategory, ReminderKind } from '../reminder-kinds';
import type { TemplateVariable } from '../reminder-template';

/** Token de inyección del canal elegido por `MESSAGING_CHANNEL`. */
export const MESSAGING_CHANNEL = Symbol('MESSAGING_CHANNEL');

export type ChannelName = 'log' | 'whatsapp_cloud';

export interface OutgoingMessage {
  /** E.164 (`+573001234567`). */
  to: string;
  kind: ReminderKind;
  category: ReminderCategory;
  /** Plantilla aprobada en Meta. */
  templateName: string;
  language: string;
  /** Parámetros del cuerpo de la plantilla de Meta, en orden. */
  params: string[];
  /** Texto con la plantilla del negocio (canal simulado y vista previa). */
  text: string;
}

export interface SendResult {
  providerMessageId: string;
}

/** Error de envío. `retryable`: red, 429 o 5xx; si no, la entrega falla. */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface MessagingChannel {
  readonly name: ChannelName;
  send(message: OutgoingMessage): Promise<SendResult>;
}

/**
 * Plantillas de Agendity en Meta (número central, D-20): una por tipo, con
 * los parámetros del cuerpo en este orden. Se crean y aprueban una vez en el
 * WhatsApp Manager (11.03). Una regla puede usar otra con `meta_template_name`
 * (mismos parámetros).
 */
export const META_TEMPLATES: Record<
  ReminderKind,
  { name: string; params: TemplateVariable[] }
> = {
  before_appointment: {
    name: 'agendity_recordatorio_cita',
    params: ['cliente', 'negocio', 'servicio', 'fecha', 'hora', 'profesional'],
  },
  maintenance: {
    name: 'agendity_mantenimiento',
    params: ['cliente', 'negocio', 'servicio', 'link_reserva'],
  },
  birthday: {
    name: 'agendity_cumpleanos',
    params: ['cliente', 'negocio', 'link_reserva'],
  },
  win_back: {
    name: 'agendity_te_extranamos',
    params: ['cliente', 'negocio', 'link_reserva'],
  },
};

export const META_TEMPLATE_LANGUAGE = 'es';
