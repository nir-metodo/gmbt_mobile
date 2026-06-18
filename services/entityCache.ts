import { appCache } from './cache';

// Per-entity, per-id view of the shared `appCache`. It lets detail screens render
// instantly from data we already loaded in a list, instead of blocking behind a
// full-screen spinner while `getById` makes a network round-trip. Detail screens
// still refresh in the background to get fresh/full data. TTL is inherited from
// `appCache`, so stale entries expire on their own.

type WithId = { id?: string };

const key = (type: string, id: string) => `entity:${type}:${id}`;

export function cacheEntity<T extends WithId>(type: string, item: T | null | undefined): void {
  if (item?.id) appCache.set(key(type, item.id), item);
}

export function cacheEntities<T extends WithId>(type: string, items: T[] | null | undefined): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item?.id) appCache.set(key(type, item.id), item);
  }
}

export function getCachedEntity<T>(type: string, id: string | undefined): T | undefined {
  if (!id) return undefined;
  return appCache.get<T>(key(type, id)) ?? undefined;
}
