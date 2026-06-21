import { contactsApi } from '../api/contacts';
import { upsertMany, countRows } from '../db/repository';
import { CONTACTS_TABLE, mapContactRow } from '../db/contactsTable';
import { getSyncCursor, setSyncCursor } from './syncMeta';

// Pulls contacts from the server in pages and upserts them into SQLite. Designed for orgs with
// tens of thousands of contacts: we never hold the whole set in JS at once - each page is
// streamed straight into the DB, and the UI reads windowed pages back out. `onProgress` lets the
// store refresh its visible window as pages land so the list fills in without waiting for the
// full pull.

const PAGE_SIZE = 1000;

type SyncOptions = {
  userId?: string;
  dataVisibility?: string;
  onProgress?: (pageCount: number, totalSoFar: number) => void;
};

// Avoid overlapping syncs for the same org (focus + mount + pull-to-refresh can all fire).
const inFlight = new Map<string, Promise<number>>();

export function syncContacts(organization: string, opts: SyncOptions = {}): Promise<number> {
  if (!organization) return Promise.resolve(0);
  const existing = inFlight.get(organization);
  if (existing) return existing;

  const run = (async () => {
    let pageNumber = 1;
    let total = 0;
    // Capture the cursor BEFORE pulling so anything modified mid-sync is caught next time.
    const startedAt = new Date().toISOString();
    const modifiedSince = (await getSyncCursor('contacts', organization)) || undefined;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await contactsApi.getAll(organization, {
          userId: opts.userId,
          dataVisibility: opts.dataVisibility,
          pageSize: PAGE_SIZE,
          pageNumber,
          modifiedSince,
        });
        const items = Array.isArray(page) ? page : [];
        if (items.length === 0) break;
        await upsertMany(CONTACTS_TABLE, items, mapContactRow);
        total += items.length;
        opts.onProgress?.(pageNumber, total);
        if (items.length < PAGE_SIZE) break;
        pageNumber += 1;
        // Safety cap so a misbehaving endpoint can't loop forever.
        if (pageNumber > 200) break;
      }
      // Advance the incremental-sync cursor only after a clean pull.
      await setSyncCursor('contacts', organization, startedAt);
    } catch {
      // Network/parse failure - keep whatever we already cached and don't advance the cursor.
    }
    return total;
  })();

  inFlight.set(organization, run);
  run.finally(() => {
    if (inFlight.get(organization) === run) inFlight.delete(organization);
  });
  return run;
}

export async function localContactCount(organization: string): Promise<number> {
  return countRows(CONTACTS_TABLE, 'organization = ?', [organization]);
}
