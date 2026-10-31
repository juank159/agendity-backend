import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { HHMM } from 'src/settings/opening-hours';
import {
  DELIVERY_STATUSES,
  REMINDER_CATEGORIES,
  REMINDER_KINDS,
  ReminderCategory,
  ReminderKind,
} from '../reminder-kinds';
import { TEMPLATE_MAX_LENGTH } from '../reminder-template';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Límites de las reglas (validación y tests). */
export const RULE_LIMITS = {
  minutesBefore: { min: 5, max: 7 * 24 * 60 },
  daysWithoutVisit: { min: 7, max: 730 },
} as const;

/** `PUT /reminders/settings` (Owner). Los campos que no llegan no cambian. */
export class UpdateReminderSettingsDto {
  @ApiPropertyOptional({ description: 'Activa los recordatorios automáticos' })
  @IsOptional()
  @IsBoolean({ message: 'enabled debe ser verdadero o falso' })
  enabled?: boolean;

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Inicio de la ventana (HH:mm, zona del negocio)',
  })
  @IsOptional()
  @Matches(HHMM, { message: 'send_window_start debe tener el formato HH:mm' })
  send_window_start?: string;

  @ApiPropertyOptional({
    example: '20:00',
    description: 'Fin de la ventana (HH:mm, excluido)',
  })
  @IsOptional()
  @Matches(HHMM, { message: 'send_window_end debe tener el formato HH:mm' })
  send_window_end?: string;
}

/** `POST /reminders/rules` (Owner). */
export class CreateReminderRuleDto {
  @ApiPropertyOptional({ enum: REMINDER_KINDS })
  @IsIn(REMINDER_KINDS, {
    message: `kind debe ser uno de: ${REMINDER_KINDS.join(', ')}`,
  })
  kind: ReminderKind;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'is_active debe ser verdadero o falso' })
  is_active?: boolean;

  @ApiPropertyOptional({
    example: 1440,
    description: 'Solo before_appointment',
  })
  @ValidateIf(
    (o) => o.kind === 'before_appointment' || o.minutes_before != null,
  )
  @IsInt({ message: 'minutes_before debe ser un número entero de minutos' })
  @Min(RULE_LIMITS.minutesBefore.min, {
    message: `minutes_before debe ser al menos ${RULE_LIMITS.minutesBefore.min}`,
  })
  @Max(RULE_LIMITS.minutesBefore.max, {
    message: `minutes_before admite hasta ${RULE_LIMITS.minutesBefore.max} (una semana)`,
  })
  minutes_before?: number | null;

  @ApiPropertyOptional({ example: 60, description: 'Solo win_back' })
  @ValidateIf((o) => o.kind === 'win_back' || o.days_without_visit != null)
  @IsInt({ message: 'days_without_visit debe ser un número entero de días' })
  @Min(RULE_LIMITS.daysWithoutVisit.min, {
    message: `days_without_visit debe ser al menos ${RULE_LIMITS.daysWithoutVisit.min}`,
  })
  @Max(RULE_LIMITS.daysWithoutVisit.max, {
    message: `days_without_visit admite hasta ${RULE_LIMITS.daysWithoutVisit.max}`,
  })
  days_without_visit?: number | null;

  @ApiPropertyOptional({
    example: '10:00',
    description: 'maintenance, birthday y win_back (HH:mm)',
  })
  @IsOptional()
  @Matches(HHMM, { message: 'send_time debe tener el formato HH:mm' })
  send_time?: string | null;

  @ApiPropertyOptional({
    description:
      'Con {cliente}, {negocio}, {servicio}, {fecha}, {hora}, {profesional}, {link_reserva}. Por defecto, la del tipo',
  })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'template debe ser texto' })
  @MaxLength(TEMPLATE_MAX_LENGTH, {
    message: `template admite hasta ${TEMPLATE_MAX_LENGTH} caracteres`,
  })
  template?: string;

  @ApiPropertyOptional({ enum: REMINDER_CATEGORIES })
  @IsOptional()
  @IsIn(REMINDER_CATEGORIES, {
    message: 'category debe ser utility o marketing',
  })
  category?: ReminderCategory;

  @ApiPropertyOptional({ description: 'Plantilla aprobada en Meta (opcional)' })
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,100}$/, {
    message: 'meta_template_name solo admite minúsculas, números y guion bajo',
  })
  meta_template_name?: string | null;
}

/** `PATCH /reminders/rules/:id`: el tipo no cambia. */
export class UpdateReminderRuleDto extends PartialType(CreateReminderRuleDto) {}

/** `POST /reminders/rules/preview`. */
export class PreviewReminderDto {
  @ApiPropertyOptional({ enum: REMINDER_KINDS })
  @IsIn(REMINDER_KINDS, {
    message: `kind debe ser uno de: ${REMINDER_KINDS.join(', ')}`,
  })
  kind: ReminderKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'template debe ser texto' })
  @MaxLength(TEMPLATE_MAX_LENGTH)
  template?: string;
}

/** `GET /reminders/deliveries`. */
export class ListDeliveriesQuery {
  @IsOptional()
  @IsIn(DELIVERY_STATUSES, {
    message: `status debe ser uno de: ${DELIVERY_STATUSES.join(', ')}`,
  })
  status?: string;

  @IsOptional()
  @IsUUID('all', { message: 'client_id debe ser un UUID' })
  client_id?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
