import type { MappedRow, TableDef } from './repository';

// Per-chat message cache. Indexed by chatPhone + createdOnMs so we can pull the last N messages
// of a conversation instantly from disk (ORDER BY createdOnMs DESC LIMIT N) on a cold open,
// before the network responds - this is what makes opening a chat feel WhatsApp-instant after
// an app restart, not just within a session.
export const MESSAGES_TABLE: TableDef = {
  name: 'messages',
  columns: [
    { name: 'chatPhone', type: 'TEXT', index: true },
    { name: 'createdOnMs', type: 'INTEGER', index: true },
    { name: 'direction', type: 'TEXT' },
    { name: 'status', type: 'TEXT' },
  ],
};

function toMs(raw: any): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  if (typeof raw === 'object') {
    if (raw._seconds) return raw._seconds * 1000;
    if (raw.seconds) return raw.seconds * 1000;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

export function makeMessageMapper(chatPhone: string) {
  return (m: any): MappedRow | null => {
    const id = m.messageId || m.id || m.Id || '';
    // Don't persist optimistic placeholders - they get a real id once the server confirms.
    if (!id || String(id).startsWith('temp_')) return null;
    return {
      id: String(id),
      columns: {
        chatPhone,
        createdOnMs: toMs(m.createdOn || m.timestamp),
        direction: m.direction || '',
        status: m.status || '',
      },
      data: m,
      updatedAt: Date.now(),
    };
  };
}
