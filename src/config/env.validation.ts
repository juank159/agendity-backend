import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { IsIanaTimeZone } from '../common/decorators/is-time-zone.decorator';

/**
 * Variables de entorno del backend (D.02). `ConfigModule.forRoot({ validate })`
 * la ejecuta al arrancar: si falta una obligatoria o tiene un formato inválido,
 * la app NO arranca y el error dice qué CLAVE revisar (nunca su valor).
 *
 * - Siempre: base de datos y secreto JWT (`ALWAYS_REQUIRED`).
 * - Con `NODE_ENV=production`, además: Wompi real, correo y URL pública
 *   (`PRODUCTION_REQUIRED`); URLs https; JWT de al menos 32 caracteres; sin
 *   `WOMPI_MODE=stub`.
 *
 * Usa class-validator (ya instalado): sin dependencias nuevas.
 */
export const ALWAYS_REQUIRED = [
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_NAME',
  'SECRET_KEY_JWT',
] as const;

export const PRODUCTION_REQUIRED = [
  'WOMPI_PUBLIC_KEY',
  'WOMPI_PRIVATE_KEY',
  'WOMPI_EVENT_INTEGRITY_SECRET',
  'WOMPI_REDIRECT_URL',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'PUBLIC_BASE_URL',
  // 11.06: firma de los links de consentimiento de WhatsApp.
  'CONSENT_LINK_SECRET',
] as const;

/** Con `MESSAGING_CHANNEL=whatsapp_cloud` (Fase 11, D-20). */
export const WHATSAPP_CLOUD_REQUIRED = [
  'WHATSAPP_CLOUD_PHONE_NUMBER_ID',
  'WHATSAPP_CLOUD_ACCESS_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
] as const;

export const JWT_MIN_LENGTH_PRODUCTION = 32;

const BOOL = ['true', 'false'];
const HTTP_URL = /^https?:\/\/\S+$/;
const HTTPS_URL = /^https:\/\/\S+$/;

/** Formato de cada clave (cuando está). */
export class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'], {
    message: 'NODE_ENV debe ser development, production o test',
  })
  NODE_ENV?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'PORT debe ser un número' })
  @Min(1, { message: 'PORT fuera de rango' })
  @Max(65535, { message: 'PORT fuera de rango' })
  PORT?: number;

  @IsOptional()
  @IsString()
  IP_LOCAL?: string;

  @IsOptional()
  @Matches(/^(true|false|\d{1,2}|[a-z0-9.:/,\s-]+)$/i, {
    message:
      'TRUST_PROXY debe ser true, false, un número de saltos o una lista de subredes',
  })
  TRUST_PROXY?: string;

  @IsOptional()
  @Matches(/^https?:\/\/[^\s,]+(\s*,\s*https?:\/\/[^\s,]+)*$/, {
    message: 'CORS_ORIGINS debe ser una lista de URLs separadas por comas',
  })
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsIn(BOOL, { message: 'SWAGGER_ENABLED debe ser true o false' })
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @Matches(HTTP_URL, { message: 'PUBLIC_BASE_URL debe ser una URL http(s)' })
  PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsIanaTimeZone({ message: 'BUSINESS_TIMEZONE no es una zona IANA válida' })
  BUSINESS_TIMEZONE?: string;

  @IsOptional()
  @IsIn(BOOL, { message: 'REMINDERS_CRON_ENABLED debe ser true o false' })
  REMINDERS_CRON_ENABLED?: string;

  @IsOptional()
  @IsIn(['log', 'whatsapp_cloud'], {
    message: 'MESSAGING_CHANNEL debe ser log o whatsapp_cloud',
  })
  MESSAGING_CHANNEL?: string;

  @IsOptional()
  @Matches(/^\d{5,20}$/, {
    message:
      'WHATSAPP_CLOUD_PHONE_NUMBER_ID debe ser el id numérico del número',
  })
  WHATSAPP_CLOUD_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_CLOUD_ACCESS_TOKEN?: string;

  @IsOptional()
  @Matches(/^v\d{1,3}\.\d$/, {
    message: 'WHATSAPP_CLOUD_API_VERSION debe tener la forma v21.0',
  })
  WHATSAPP_CLOUD_API_VERSION?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;

  @IsOptional()
  @IsString()
  CONSENT_LINK_SECRET?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'DB_PORT debe ser un número' })
  DB_PORT?: number;

  @IsOptional()
  @IsIn(BOOL, { message: 'DB_MIGRATIONS_RUN debe ser true o false' })
  DB_MIGRATIONS_RUN?: string;

  @IsOptional()
  @IsIn(['true', 'false', 'no-verify'], {
    message: 'DB_SSL debe ser true, false o no-verify',
  })
  DB_SSL?: string;

  @IsOptional()
  @Matches(HTTP_URL, { message: 'WOMPI_REDIRECT_URL debe ser una URL http(s)' })
  WOMPI_REDIRECT_URL?: string;

  @IsOptional()
  @IsIn(['normal', 'stub'], { message: 'WOMPI_MODE debe ser normal o stub' })
  WOMPI_MODE?: string;

  @IsOptional()
  @Matches(HTTPS_URL, { message: 'MONITORING_WEBHOOK debe ser una URL https' })
  MONITORING_WEBHOOK?: string;
}

/**
 * Problemas de la configuración (solo nombres de claves, nunca valores).
 * Vacío = válida. Una clave vacía (`KEY=`) cuenta como ausente.
 */
export function envProblems(config: Record<string, unknown>): string[] {
  const present = Object.fromEntries(
    Object.entries(config).filter(
      ([, v]) => v !== undefined && v !== null && String(v).trim() !== '',
    ),
  );
  const problems: string[] = [];
  for (const key of ALWAYS_REQUIRED) {
    if (!(key in present)) problems.push(`Falta ${key}`);
  }
  if (present.MESSAGING_CHANNEL === 'whatsapp_cloud') {
    for (const key of WHATSAPP_CLOUD_REQUIRED) {
      if (!(key in present)) {
        problems.push(
          `Falta ${key} (obligatoria con MESSAGING_CHANNEL=whatsapp_cloud)`,
        );
      }
    }
  }
  const production = present.NODE_ENV === 'production';
  if (production) {
    for (const key of PRODUCTION_REQUIRED) {
      if (!(key in present))
        problems.push(`Falta ${key} (obligatoria en producción)`);
    }
    for (const key of ['WOMPI_REDIRECT_URL', 'PUBLIC_BASE_URL']) {
      if (key in present && !HTTPS_URL.test(String(present[key]))) {
        problems.push(`${key} debe ser https en producción`);
      }
    }
    if (
      'SECRET_KEY_JWT' in present &&
      String(present.SECRET_KEY_JWT).length < JWT_MIN_LENGTH_PRODUCTION
    ) {
      problems.push(
        `SECRET_KEY_JWT debe tener al menos ${JWT_MIN_LENGTH_PRODUCTION} caracteres en producción`,
      );
    }
    if (
      'CONSENT_LINK_SECRET' in present &&
      String(present.CONSENT_LINK_SECRET).length < JWT_MIN_LENGTH_PRODUCTION
    ) {
      problems.push(
        `CONSENT_LINK_SECRET debe tener al menos ${JWT_MIN_LENGTH_PRODUCTION} caracteres en producción`,
      );
    }
    if (present.WOMPI_MODE === 'stub') {
      problems.push('WOMPI_MODE=stub no se permite en producción');
    }
  }
  const errors = validateSync(plainToInstance(EnvironmentVariables, present), {
    forbidUnknownValues: false,
  });
  for (const error of errors) {
    problems.push(...Object.values(error.constraints ?? {}));
  }
  return [...new Set(problems)];
}

/** Para `ConfigModule.forRoot({ validate: validateEnv })`: falla con la lista de claves. */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems = envProblems(config);
  if (problems.length) {
    throw new Error(
      `Configuración inválida (revisa el .env):\n- ${problems.join('\n- ')}`,
    );
  }
  return config;
}
