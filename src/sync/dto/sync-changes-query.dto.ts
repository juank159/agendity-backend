import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { SYNC_PAGE } from '../sync.service';

/** Query de `GET /sync/changes` (10.01a). */
export class SyncChangesQueryDto {
  @ApiPropertyOptional({
    description: 'Última versión recibida; "0" o ausente = carga inicial',
    example: '0',
  })
  @IsOptional()
  @Matches(/^\d{1,18}$/, { message: 'Cursor de sincronización inválido' })
  cursor?: string;

  @ApiPropertyOptional({ default: SYNC_PAGE.default, maximum: SYNC_PAGE.max })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El límite debe ser un número entero' })
  @Min(1, { message: 'El límite mínimo es 1' })
  @Max(SYNC_PAGE.max, { message: `El límite máximo es ${SYNC_PAGE.max}` })
  limit?: number;
}
