import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessSettings } from './entities/business-settings.entity';
import { SettingsController } from './settings.controller';
import { TenantSettingsService } from './tenant-settings.service';

/** Configuración por negocio (6.01, D-15). Exporta `TenantSettingsService`. */
@Module({
  imports: [TypeOrmModule.forFeature([BusinessSettings])],
  controllers: [SettingsController],
  providers: [TenantSettingsService],
  exports: [TenantSettingsService],
})
export class SettingsModule {}
