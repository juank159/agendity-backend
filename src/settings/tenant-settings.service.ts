import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  defaultBusinessTimeZone,
  normalizeTimeZone,
} from 'src/common/utils/date.util';
import { BusinessSettings } from './entities/business-settings.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Lo que devuelven `GET` y `PATCH /settings`. Crece con los ajustes nuevos. */
export interface BusinessSettingsView {
  timezone: string;
}

/** La caché de la zona caduca sola: con varias instancias, el PATCH solo invalida la propia. */
export const TIMEZONE_CACHE_TTL_MS = 5 * 60_000;

/**
 * Configuración de cada negocio (6.01, D-15). Hoy, su zona horaria.
 *
 * - `getTimezone(tenantId)`: la zona del tenant, con caché en memoria (TTL de
 *   5 min); `PATCH` y el alta la invalidan. Es lo que usa la 6.02 en vez de
 *   `BUSINESS_TIMEZONE`.
 * - Un negocio sin fila (no debería haberlo: la crea el alta y la migración
 *   rellenó los existentes) o con una zona que `Intl` ya no reconoce usa
 *   `BUSINESS_TIMEZONE`. Leer **no escribe** (ARQUITECTURA §5).
 */
@Injectable()
export class TenantSettingsService {
  private readonly logger = new Logger(TenantSettingsService.name);
  private readonly cache = new Map<
    string,
    { timezone: string; expiresAt: number }
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
    requestedTimezone: unknown,
    manager: EntityManager,
  ): Promise<BusinessSettings> {
    const settings = await manager.save(
      manager.create(BusinessSettings, {
        tenant_id: this.requireTenant(tenantId),
        timezone: this.initialTimezone(requestedTimezone),
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
    const view = { timezone: this.storedTimezone(tenantId, row) };
    this.remember(tenantId, view.timezone);
    return view;
  }

  /** Zona IANA del negocio, cacheada. */
  async getTimezone(tenantId: string): Promise<string> {
    const cached = this.cache.get(this.requireTenant(tenantId));
    if (cached && cached.expiresAt > Date.now()) {
      return cached.timezone;
    }
    return (await this.getSettings(tenantId)).timezone;
  }

  /** `PATCH /settings` (solo Owner). Guarda la zona canónica e invalida la caché. */
  async updateSettings(
    tenantId: string,
    dto: UpdateSettingsDto,
  ): Promise<BusinessSettingsView> {
    this.requireTenant(tenantId);
    if (dto.timezone !== undefined && dto.timezone !== null) {
      // El DTO ya la validó; `normalizeTimeZone` da el nombre canónico.
      const timezone = normalizeTimeZone(dto.timezone) as string;
      const row = await this.settingsRepository.findOne({
        where: { tenant_id: tenantId },
      });
      if (row) {
        if (row.timezone !== timezone) {
          row.timezone = timezone;
          await this.settingsRepository.save(row);
        }
      } else {
        await this.settingsRepository.insert({ tenant_id: tenantId, timezone });
      }
      this.cache.delete(tenantId);
    }
    return this.getSettings(tenantId);
  }

  /** Vacía la caché (tests). */
  clearCache(): void {
    this.cache.clear();
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

  private remember(tenantId: string, timezone: string): void {
    this.cache.set(tenantId, {
      timezone,
      expiresAt: Date.now() + TIMEZONE_CACHE_TTL_MS,
    });
  }

  /** TypeORM ignora `where: { tenant_id: undefined }`: nunca consultar sin tenant. */
  private requireTenant(tenantId: string): string {
    if (!tenantId) {
      throw new Error('TenantSettingsService: falta el tenant');
    }
    return tenantId;
  }
}
