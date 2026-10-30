import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Like, Repository } from 'typeorm';
import { BusinessException } from 'src/common/exceptions/business.exception';
import { ErrorCode } from 'src/common/constants/error-codes';
import {
  defaultBusinessTimeZone,
  normalizeTimeZone,
} from 'src/common/utils/date.util';
import { BusinessSettings } from './entities/business-settings.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { firstFreeSlug, slugify } from './business-slug';
import {
  OpeningHoursRange,
  openingHoursError,
  sortOpeningHours,
} from './opening-hours';

/** Lo que devuelven `GET` y `PATCH /settings`. Crece con los ajustes nuevos. */
export interface BusinessSettingsView {
  timezone: string;
  /** Nombre del negocio (8.00); `null` si aún no lo puso. */
  name: string | null;
  /** Identificador del link público (8.00, Fase 9); `null` sin nombre. */
  slug: string | null;
  /** Horario de apertura (8.01); `null` = sin configurar (sin límite). */
  opening_hours: OpeningHoursRange[] | null;
}

/** Datos opcionales del negocio en el alta del Owner. */
export interface NewBusinessSettings {
  /** Zona del dispositivo (6.01): si falta o no es válida, `BUSINESS_TIMEZONE`. */
  timezone?: unknown;
  /** Nombre del negocio (8.00), ya validado por el DTO. */
  name?: string | null;
}

/** La caché caduca sola: con varias instancias, el PATCH solo invalida la propia. */
export const TIMEZONE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Configuración de cada negocio: zona horaria (6.01, D-15), nombre y slug
 * (8.00) y horario de apertura (8.01).
 *
 * - `getTimezone` / `getOpeningHours` / `getSettings`: con caché en memoria de
 *   la configuración entera (TTL de 5 min); `PATCH` y el alta la invalidan.
 * - Un negocio sin fila (no debería haberlo: la crea el alta y la migración
 *   rellenó los existentes) o con una zona que `Intl` ya no reconoce usa
 *   `BUSINESS_TIMEZONE`, sin nombre ni horario. Leer **no escribe**
 *   (ARQUITECTURA §5).
 */
@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);
  private readonly cache = new Map<
    string,
    { view: BusinessSettingsView; expiresAt: number }
  >();

  constructor(
    @InjectRepository(BusinessSettings)
    private readonly settingsRepository: Repository<BusinessSettings>,
  ) {}

  /**
   * Zona de un negocio nuevo: la que manda la app (la del dispositivo) si es
   * una zona IANA válida; si no llega o no es válida, `BUSINESS_TIMEZONE`.
   */
  initialTimezone(requested: unknown): string {
    const timezone = normalizeTimeZone(requested);
    if (requested != null && requested !== '' && !timezone) {
      this.logger.warn(
        `Zona horaria inválida en el alta; se usa ${defaultBusinessTimeZone()}`,
      );
    }
    return timezone ?? defaultBusinessTimeZone();
  }

  /**
   * Crea la configuración de un negocio nuevo dentro de la transacción del
   * alta (`AuthService.createOwnerAccount`): si falla, no queda el Owner.
   */
  async createForTenant(
    tenantId: string,
    data: NewBusinessSettings,
    manager: EntityManager,
  ): Promise<BusinessSettings> {
    const name = data.name?.trim() || null;
    const settings = await manager.save(
      manager.create(BusinessSettings, {
        tenant_id: this.requireTenant(tenantId),
        timezone: this.initialTimezone(data.timezone),
        name,
        slug: name
          ? await this.freeSlug(name, manager.getRepository(BusinessSettings))
          : null,
      }),
    );
    this.cache.delete(tenantId);
    return settings;
  }

  /** `GET /settings`: siempre desde la BD (y refresca la caché). */
  async getSettings(tenantId: string): Promise<BusinessSettingsView> {
    const row = await this.settingsRepository.findOne({
      where: { tenant_id: this.requireTenant(tenantId) },
    });
    const view: BusinessSettingsView = {
      timezone: this.storedTimezone(tenantId, row),
      name: row?.name ?? null,
      slug: row?.slug ?? null,
      opening_hours: row?.opening_hours ?? null,
    };
    this.cache.set(tenantId, {
      view,
      expiresAt: Date.now() + TIMEZONE_CACHE_TTL_MS,
    });
    return view;
  }

  /** Configuración del negocio, cacheada. */
  async getCachedSettings(tenantId: string): Promise<BusinessSettingsView> {
    const cached = this.cache.get(this.requireTenant(tenantId));
    if (cached && cached.expiresAt > Date.now()) return cached.view;
    return this.getSettings(tenantId);
  }

  /** Zona IANA del negocio, cacheada. */
  async getTimezone(tenantId: string): Promise<string> {
    return (await this.getCachedSettings(tenantId)).timezone;
  }

  /** Horario de apertura del negocio (8.01), cacheado; `null` = sin límite. */
  async getOpeningHours(tenantId: string): Promise<OpeningHoursRange[] | null> {
    return (await this.getCachedSettings(tenantId)).opening_hours;
  }

  /**
   * `PATCH /settings` (solo Owner). Solo escribe los campos que cambian;
   * zona canónica (6.01), nombre (8.00: el slug se genera la primera vez) y
   * horario ordenado (8.01). Invalida la caché.
   */
  async updateSettings(
    tenantId: string,
    dto: UpdateSettingsDto,
  ): Promise<BusinessSettingsView> {
    this.requireTenant(tenantId);
    const row = await this.settingsRepository.findOne({
      where: { tenant_id: tenantId },
    });
    const changes: Partial<BusinessSettings> = {};

    if (dto.timezone !== undefined && dto.timezone !== null) {
      // El DTO ya la validó; `normalizeTimeZone` da el nombre canónico.
      const timezone = normalizeTimeZone(dto.timezone) as string;
      if (row?.timezone !== timezone) changes.timezone = timezone;
    }
    if (typeof dto.name === 'string' && dto.name !== row?.name) {
      changes.name = dto.name;
      if (!row?.slug) {
        changes.slug = await this.freeSlug(dto.name, this.settingsRepository);
      }
    }
    if (dto.opening_hours !== undefined) {
      const hours =
        dto.opening_hours === null ? null : sortOpeningHours(dto.opening_hours);
      const error = hours && openingHoursError(hours);
      if (error) {
        throw new BusinessException(ErrorCode.VALIDATION_ERROR, error);
      }
      if (
        JSON.stringify(hours) !== JSON.stringify(row?.opening_hours ?? null)
      ) {
        changes.opening_hours = hours;
      }
    }

    if (Object.keys(changes).length) {
      if (row) {
        await this.settingsRepository.save({ ...row, ...changes });
      } else {
        await this.settingsRepository.insert({
          tenant_id: tenantId,
          timezone: defaultBusinessTimeZone(),
          ...changes,
        });
      }
      this.cache.delete(tenantId);
    }
    return this.getSettings(tenantId);
  }

  /** Vacía la caché (tests). */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Primer slug libre para el nombre (8.00). Si dos altas eligen el mismo a la
   * vez, el índice único hace fallar a la segunda (raro; reintentar basta).
   */
  private async freeSlug(
    name: string,
    repository: Repository<BusinessSettings>,
  ): Promise<string | null> {
    const base = slugify(name);
    if (!base) return null;
    const taken = await repository.find({
      where: { slug: Like(`${base}%`) },
      select: { slug: true },
    });
    return firstFreeSlug(
      base,
      taken.map((row) => row.slug as string),
    );
  }

  private storedTimezone(
    tenantId: string,
    row: BusinessSettings | null,
  ): string {
    if (!row) return defaultBusinessTimeZone();
    const timezone = normalizeTimeZone(row.timezone);
    if (!timezone) {
      this.logger.warn(
        `Zona horaria guardada inválida para el negocio ${tenantId}; se usa ${defaultBusinessTimeZone()}`,
      );
      return defaultBusinessTimeZone();
    }
    return timezone;
  }

  /** TypeORM ignora `where: { tenant_id: undefined }`: nunca consultar sin tenant. */
  private requireTenant(tenantId: string): string {
    if (!tenantId) {
      throw new Error('TenantSettingsService: falta el tenant');
    }
    return tenantId;
  }
}
