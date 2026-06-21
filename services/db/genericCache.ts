import type { TableDef } from './repository';
import { upsertMany, queryPage, deleteById as repoDeleteById } from './repository';

// Reusable, schema-light disk cache for any per-organization list (leads, orders, tasks, ...).
// Each entity gets a `cache_<entity>` table of (id, organization, data JSON). It gives every
// list instant-open after an app restart - the screen renders the cached rows immediately, then
// the server response replaces them - without the per-field indexing/FTS we reserve for the
// heavy, must-scale entities (contacts, messages). Reads/writes are capped so even large sets
// stay cheap: we only need enough rows to fill the screen instantly while fresh data loads.
const READ_CAP = 1000;
const WRITE_CAP = 2000;

const tables = new Map<string, TableDef>();

function tableFor(entity: string): TableDef {
  let def = tables.get(entity);
  if (!def) {
    def = {
      name: `cache_${entity}`,
      columns: [{ name: 'organization', type: 'TEXT', index: true }],
    };
    tables.set(entity, def);
  }
  return def;
}

export async function readList<T>(
  entity: string,
  organization: string,
  limit = READ_CAP,
): Promise<T[]> {
  if (!organization) return [];
  try {
    return await queryPage<T>(tableFor(entity), {
      where: 'organization = ?',
      params: [organization],
      orderBy: 'updatedAt DESC',
      limit,
    });
  } catch {
    return [];
  }
}

export function cacheList<T>(
  entity: string,
  organization: string,
  items: T[],
  getId: (item: T) => string | undefined,
): void {
  if (!organization || !items || items.length === 0) return;
  const capped = items.slice(0, WRITE_CAP);
  upsertMany(tableFor(entity), capped, (item) => {
    const id = getId(item);
    if (!id) return null;
    return { id: String(id), columns: { organization }, data: item };
  }).catch(() => {});
}

export function removeFromCache(entity: string, id: string): void {
  if (!id) return;
  repoDeleteById(tableFor(entity), id).catch(() => {});
}
