import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  isScoped,
  SYNC_ENTITIES,
  SyncEntity,
  SyncViewer,
  visibleEntities,
} from './sync-entities';

/** Un cambio del feed. */
export interface SyncChange {
  entity: string;
  id: string;
  version: string;
  /** `upsert`: fila actual en `data`; `delete`: se borró; `leave_scope`: ya no es tuya. */
  op: 'upsert' | 'delete' | 'leave_scope';
  data: unknown | null;
}

export interface SyncChangesPage {
  changes: SyncChange[];
  /** Pásalo en la siguiente petición. `"0"` = carga inicial. */
  cursor: string;
  has_more: boolean;
}

export const SYNC_PAGE = { default: 500, max: 1000 } as const;

const CURSOR = /^\d{1,18}$/;

/**
 * Bajada de cambios por negocio (10.01a, D-18). La versión de cada fila la
 * pone Postgres (`sync_bump`) bajo el lock de la fila del negocio en
 * `sync_tenant_version`, así que las versiones se confirman en orden y el
 * cursor (la última versión entregada) nunca se salta un cambio. Borrados y
 * salidas de alcance vienen de `sync_tombstones`. Permisos = los de la API:
 * ver `sync-entities.ts`.
 */
@Injectable()
export class SyncService {
  constructor(private readonly dataSource: DataSource) {}

  async changes(
    viewer: SyncViewer,
    cursorParam: string | undefined,
    limitParam: number | undefined,
  ): Promise<SyncChangesPage> {
    const cursor = cursorParam ?? '0';
    if (!CURSOR.test(cursor)) {
      throw new BadRequestException('Cursor de sincronización inválido');
    }
    const limit = Math.min(
      Math.max(Math.trunc(limitParam ?? SYNC_PAGE.default), 1),
      SYNC_PAGE.max,
    );
    const entities = visibleEntities(viewer);
    const { sql, params } = changesQuery(viewer, entities, cursor, limit + 1);
    const rows: { entity: string; id: string; version: string; op: string }[] =
      await this.dataSource.query(sql, params);

    const page = rows.slice(0, limit);
    const data = await this.loadRows(viewer, page);
    const changes: SyncChange[] = [];
    for (const row of page) {
      if (row.op === 'upsert') {
        const current = data.get(`${row.entity}:${row.id}`);
        // Borrada después de listarla: su tombstone llega con versión mayor.
        if (current === undefined) continue;
        changes.push({ ...row, op: 'upsert', data: current });
      } else {
        changes.push({
          ...row,
          op: row.op as SyncChange['op'],
          data: null,
        });
      }
    }
    return {
      changes,
      cursor: page.length ? String(page[page.length - 1].version) : cursor,
      has_more: rows.length > limit,
    };
  }

  /** Carga las filas `upsert` de la página, por entidad, con la forma de la API. */
  private async loadRows(
    viewer: SyncViewer,
    page: { entity: string; id: string; op: string }[],
  ): Promise<Map<string, unknown>> {
    const idsByEntity = new Map<string, string[]>();
    for (const row of page) {
      if (row.op !== 'upsert') continue;
      idsByEntity.set(row.entity, [
        ...(idsByEntity.get(row.entity) ?? []),
        row.id,
      ]);
    }
    const out = new Map<string, unknown>();
    for (const [name, ids] of idsByEntity) {
      const entity = SYNC_ENTITIES.find((e) => e.name === name) as SyncEntity;
      for (const { id, data } of await entity.load(
        this.dataSource.manager,
        ids,
        viewer,
      )) {
        out.set(`${name}:${id}`, data);
      }
    }
    return out;
  }
}

/**
 * Una sola consulta: filas con versión mayor que el cursor de cada tabla que
 * ve el rol (con su alcance) + tombstones, ordenadas por versión.
 * Parámetros: $1 negocio, $2 cursor, $3 usuario, $4 límite.
 */
export function changesQuery(
  viewer: SyncViewer,
  entities: SyncEntity[],
  cursor: string,
  limit: number,
): { sql: string; params: unknown[] } {
  const parts = entities.map((entity) => {
    const scope = isScoped(entity, viewer)
      ? ` AND ${entity.scope!.column} = $3`
      : '';
    return `SELECT '${entity.name}'::text AS entity, ${entity.idColumn}::text AS id,
                   sync_version AS version, 'upsert'::text AS op
              FROM "${entity.table}"
             WHERE ${entity.tenantColumn} = $1 AND sync_version > $2${scope}`;
  });
  const visible = entities.map((e) => e.name);
  const scoped = entities.filter((e) => isScoped(e, viewer)).map((e) => e.name);
  parts.push(`SELECT entity::text, entity_id::text AS id, version, kind::text AS op
                FROM sync_tombstones
               WHERE tenant_id = $1 AND version > $2
                 AND entity = ANY($5::text[])
                 AND (scope_user_id = $3 OR NOT (entity = ANY($6::text[])))
                 AND (kind = 'delete' OR scope_user_id = $3)`);
  return {
    sql: `${parts.join('\nUNION ALL\n')}\nORDER BY version LIMIT $4`,
    params: [viewer.tenantId, cursor, viewer.userId, limit, visible, scoped],
  };
}
