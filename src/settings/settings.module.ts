import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessSettings } from './entities/business-settings.entity';
import { SettingsController } from './settings.controller';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantTimeZoneInterceptor } from './tenant-time-zone.interceptor';

/**
 * Configuración por negocio (6.01, D-15). Exporta `TenantSettingsService`
 * (zona de cada tenant) y registra `TenantTimeZoneInterceptor` (6.02).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BusinessSettings])],
  controllers: [SettingsController],
  providers: [
    TenantSettingsService,
    // Zona del tenant de cada petición con sesión (6.02): fechas de la query y
    // de la respuesta en la zona del negocio.
    { provide: APP_INTERCEPTOR, useClass: TenantTimeZoneInterceptor },
  ],
  exports: [TenantSettingsService],
})
export class SettingsModule {}
