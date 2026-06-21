import * as SQLite from 'expo-sqlite';

// Single on-device SQLite database that backs the local-first data layer. It lives in the
// app's private sandbox (Android databases/, iOS app container) - not user-visible, removed
// on uninstall. We keep one shared connection for the whole app; expo-sqlite serializes
// access internally so a singleton is both correct and fastest.

const DB_NAME = 'gambot.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      // WAL = concurrent reads while writing + far fewer fsyncs, which is what keeps lists
      // and chat "flying" at tens of thousands of rows. foreign_keys on for integrity.
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      return db;
    })();
  }
  return dbPromise;
}

// Drops the whole local cache (used on logout / org switch so one user's data never bleeds
// into another's). Tables are recreated lazily on next use via repository.ensureTable.
export async function resetDatabase(): Promise<void> {
  try {
    const db = await getDb();
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
    );
    await db.withTransactionAsync(async () => {
      for (const t of tables) {
        await db.execAsync(`DROP TABLE IF EXISTS ${t.name}`);
      }
    });
  } catch {
    // best-effort
  }
}
