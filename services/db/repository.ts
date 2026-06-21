import { getDb, resetDatabase } from './database';

// Generic, entity-agnostic persistence over SQLite. Every entity (contacts, messages, leads,
// orders, tasks...) is stored in its own table shaped the same way:
//   rowid INTEGER PK | id TEXT UNIQUE | <indexed columns> | data TEXT (full JSON) | updatedAt
// Indexed columns exist purely so we can filter/sort/paginate at the DB level (so a list never
// loads more than the visible window into memory); the full object is reconstructed from `data`.
// Optional FTS5 columns give instant substring/prefix search that scales to tens of thousands
// of rows. New entities just declare a TableDef - no bespoke SQL per screen.

export type ColumnType = 'TEXT' | 'INTEGER' | 'REAL';

export interface ColumnDef {
  name: string;
  type?: ColumnType;
  index?: boolean;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  // Subset of `columns` (by name) to expose to full-text search. Uses an external-content
  // FTS5 table kept in sync via triggers.
  ftsColumns?: string[];
}

export interface MappedRow {
  id: string;
  columns: Record<string, string | number | null>;
  data: unknown;
  updatedAt?: number;
}

export interface QueryOptions {
  where?: string;
  params?: (string | number | null)[];
  orderBy?: string;
  limit?: number;
  offset?: number;
}

const ensured = new Set<string>();

function ftsTable(name: string): string {
  return `${name}_fts`;
}

export async function ensureTable(def: TableDef): Promise<void> {
  if (ensured.has(def.name)) return;
  const db = await getDb();

  const colDefs = def.columns
    .map((c) => `${c.name} ${c.type || 'TEXT'}`)
    .join(', ');

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS ${def.name} (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      ${colDefs ? colDefs + ',' : ''}
      data TEXT NOT NULL,
      updatedAt INTEGER NOT NULL DEFAULT 0
    );`,
  );

  for (const c of def.columns) {
    if (c.index) {
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_${def.name}_${c.name} ON ${def.name}(${c.name});`,
      );
    }
  }

  if (def.ftsColumns && def.ftsColumns.length > 0) {
    const fts = ftsTable(def.name);
    const ftsCols = def.ftsColumns.join(', ');
    await db.execAsync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${fts} USING fts5(
        ${ftsCols}, content='${def.name}', content_rowid='rowid', tokenize='unicode61'
      );`,
    );
    // External-content sync triggers (the canonical FTS5 pattern).
    await db.execAsync(
      `CREATE TRIGGER IF NOT EXISTS ${def.name}_ai AFTER INSERT ON ${def.name} BEGIN
        INSERT INTO ${fts}(rowid, ${ftsCols}) VALUES (new.rowid, ${def.ftsColumns
        .map((c) => `new.${c}`)
        .join(', ')});
      END;`,
    );
    await db.execAsync(
      `CREATE TRIGGER IF NOT EXISTS ${def.name}_ad AFTER DELETE ON ${def.name} BEGIN
        INSERT INTO ${fts}(${fts}, rowid, ${ftsCols}) VALUES ('delete', old.rowid, ${def.ftsColumns
        .map((c) => `old.${c}`)
        .join(', ')});
      END;`,
    );
    await db.execAsync(
      `CREATE TRIGGER IF NOT EXISTS ${def.name}_au AFTER UPDATE ON ${def.name} BEGIN
        INSERT INTO ${fts}(${fts}, rowid, ${ftsCols}) VALUES ('delete', old.rowid, ${def.ftsColumns
        .map((c) => `old.${c}`)
        .join(', ')});
        INSERT INTO ${fts}(rowid, ${ftsCols}) VALUES (new.rowid, ${def.ftsColumns
        .map((c) => `new.${c}`)
        .join(', ')});
      END;`,
    );
  }

  ensured.add(def.name);
}

export async function upsertMany<T>(
  def: TableDef,
  items: T[],
  mapRow: (item: T) => MappedRow | null,
): Promise<void> {
  if (!items || items.length === 0) return;
  await ensureTable(def);
  const db = await getDb();

  const cols = def.columns.map((c) => c.name);
  const insertCols = ['id', ...cols, 'data', 'updatedAt'];
  const placeholders = insertCols.map(() => '?').join(', ');
  const updateSet = [...cols, 'data', 'updatedAt']
    .map((c) => `${c}=excluded.${c}`)
    .join(', ');
  const sql = `INSERT INTO ${def.name} (${insertCols.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updateSet};`;

  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(sql);
    try {
      for (const item of items) {
        const r = mapRow(item);
        if (!r || !r.id) continue;
        const values: (string | number | null)[] = [
          r.id,
          ...cols.map((c) => r.columns[c] ?? null),
          JSON.stringify(r.data ?? item),
          r.updatedAt ?? Date.now(),
        ];
        await stmt.executeAsync(values);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

export async function queryPage<T>(def: TableDef, opts: QueryOptions = {}): Promise<T[]> {
  await ensureTable(def);
  const db = await getDb();
  const where = opts.where ? `WHERE ${opts.where}` : '';
  const order = opts.orderBy ? `ORDER BY ${opts.orderBy}` : '';
  const limit = opts.limit != null ? `LIMIT ${opts.limit}` : '';
  const offset = opts.offset ? `OFFSET ${opts.offset}` : '';
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM ${def.name} ${where} ${order} ${limit} ${offset};`,
    opts.params ?? [],
  );
  return rows.map((r) => safeParse<T>(r.data)).filter((x): x is T => x != null);
}

// Build an FTS5 prefix-match query from raw user input. Each whitespace token becomes a quoted
// prefix term, ANDed together: `john 050` -> `"john"* "050"*`. Quoting makes arbitrary input
// (punctuation, etc.) safe from FTS syntax errors.
export function buildFtsQuery(term: string): string | null {
  const tokens = (term || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

export async function searchFts<T>(
  def: TableDef,
  term: string,
  opts: QueryOptions = {},
): Promise<T[]> {
  await ensureTable(def);
  const match = buildFtsQuery(term);
  if (!match) return [];
  const db = await getDb();
  const fts = ftsTable(def.name);
  // Filter the base table by rowid membership in the FTS match, rather than a JOIN, so column
  // names shared between the table and the FTS index (e.g. a `keysText` tag filter combined with
  // a search term) can never be ambiguous.
  const extraWhere = opts.where ? `AND ${opts.where}` : '';
  const order = opts.orderBy ? `ORDER BY ${opts.orderBy}` : '';
  const limit = opts.limit != null ? `LIMIT ${opts.limit}` : 'LIMIT 50';
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM ${def.name}
     WHERE rowid IN (SELECT rowid FROM ${fts} WHERE ${fts} MATCH ?) ${extraWhere} ${order} ${limit};`,
    [match, ...(opts.params ?? [])],
  );
  return rows.map((r) => safeParse<T>(r.data)).filter((x): x is T => x != null);
}

// Distinct values of a single indexed column - used to build filter facets (owners, statuses,
// tags) at the DB level instead of scanning a full in-memory array. `limit` bounds the work so
// facets stay cheap even on huge tables.
export async function distinctValues(
  def: TableDef,
  column: string,
  where?: string,
  params?: (string | number | null)[],
  limit = 5000,
): Promise<string[]> {
  await ensureTable(def);
  const db = await getDb();
  const rows = await db.getAllAsync<{ v: string }>(
    `SELECT DISTINCT ${column} as v FROM ${def.name} ${where ? 'WHERE ' + where : ''} LIMIT ${limit};`,
    params ?? [],
  );
  return rows.map((r) => r.v).filter((v) => v != null && v !== '');
}

export async function countRows(
  def: TableDef,
  where?: string,
  params?: (string | number | null)[],
): Promise<number> {
  await ensureTable(def);
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM ${def.name} ${where ? 'WHERE ' + where : ''};`,
    params ?? [],
  );
  return row?.c ?? 0;
}

export async function getById<T>(def: TableDef, id: string): Promise<T | null> {
  if (!id) return null;
  await ensureTable(def);
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>(
    `SELECT data FROM ${def.name} WHERE id = ?;`,
    [id],
  );
  return row ? safeParse<T>(row.data) : null;
}

export async function deleteById(def: TableDef, id: string): Promise<void> {
  if (!id) return;
  await ensureTable(def);
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${def.name} WHERE id = ?;`, [id]);
}

export async function clearTable(def: TableDef): Promise<void> {
  await ensureTable(def);
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${def.name};`);
}

// Wipe the entire local DB (logout / org switch) and forget which tables we've created so
// they're rebuilt cleanly on next use.
export async function resetLocalDb(): Promise<void> {
  await resetDatabase();
  ensured.clear();
}

function safeParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
