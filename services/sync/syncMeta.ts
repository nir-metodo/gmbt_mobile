import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-entity, per-organization "last successful sync" cursor. We send it to the server as
// `modifiedSince` so that once the backend supports it, each sync pulls only records changed
// since last time (incremental sync) instead of the full set. Until the backend honors the
// param it is simply ignored and we keep doing full pulls - so this is safe and forward-compatible.
// Stored as an ISO timestamp string.

function key(entity: string, organization: string): string {
  return `sync_cursor_${entity}_${organization}`;
}

export async function getSyncCursor(entity: string, organization: string): Promise<string | null> {
  if (!organization) return null;
  try {
    return await AsyncStorage.getItem(key(entity, organization));
  } catch {
    return null;
  }
}

export async function setSyncCursor(
  entity: string,
  organization: string,
  isoTimestamp: string,
): Promise<void> {
  if (!organization || !isoTimestamp) return;
  try {
    await AsyncStorage.setItem(key(entity, organization), isoTimestamp);
  } catch {
    // best-effort
  }
}
