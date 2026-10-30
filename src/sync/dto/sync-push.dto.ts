import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Operaciones de negocio que la app puede subir (10.01b, D-18). */
export const SYNC_MUTATION_TYPES = [
  'client.create',
  'client.update',
  'client.delete',
  'appointment.create',
  'appointment.update',
  'appointment.cancel',
  'appointment.complete',
  'payment.create',
  'payment.refund',
  'time_block.create',
  'time_block.update',
  'time_block.delete',
  'service.create',
  'service.update',
  'service.delete',
  'category.create',
  'category.update',
  'category.delete',
] as const;
export type SyncMutationType = (typeof SYNC_MUTATION_TYPES)[number];

export const SYNC_PUSH_MAX = 100;

/** Una mutación hecha en el dispositivo. */
export class SyncMutationDto {
  @ApiProperty({ description: 'Id único de la mutación (idempotencia)' })
  @IsUUID('all', { message: 'mutation_id debe ser un UUID' })
  mutation_id: string;

  @ApiProperty({ enum: SYNC_MUTATION_TYPES })
  @IsIn(SYNC_MUTATION_TYPES as unknown as string[], {
    message: 'Tipo de mutación desconocido',
  })
  type: SyncMutationType;

  @ApiPropertyOptional({
    description:
      'Id del registro: el que generó la app al crear, o el que se edita, borra, cancela, completa o reembolsa',
  })
  @IsOptional()
  @IsUUID('all', { message: 'entity_id debe ser un UUID' })
  entity_id?: string;

  @ApiPropertyOptional({
    description:
      'Los mismos campos que la ruta online de esa operación (sin id)',
  })
  @IsOptional()
  @IsObject({ message: 'payload debe ser un objeto' })
  payload?: Record<string, unknown>;

  @ApiProperty({
    description:
      'Cuándo se hizo en el dispositivo (ISO con offset). Hasta 30 días atrás y 5 min adelante',
  })
  @IsISO8601({}, { message: 'client_time debe ser una fecha ISO' })
  client_time: string;
}

/** `POST /sync/push`. */
export class SyncPushDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  device_id?: string;

  @ApiProperty({ type: [SyncMutationDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'El lote no tiene mutaciones' })
  @ArrayMaxSize(SYNC_PUSH_MAX, {
    message: `Como máximo ${SYNC_PUSH_MAX} mutaciones por lote`,
  })
  @ValidateNested({ each: true })
  @Type(() => SyncMutationDto)
  mutations: SyncMutationDto[];
}
