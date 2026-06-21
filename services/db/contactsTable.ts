import type { Contact } from '../../types';
import type { MappedRow, TableDef } from './repository';

// SQLite schema for contacts. Indexed columns are exactly the ones the list filters/sorts on,
// so a query never has to scan or hold the full table in memory. `keysText` is a denormalized
// `#tag1#tag2#` string so a tag filter is a simple indexed LIKE, and FTS covers name/phone/email/tags.
export const CONTACTS_TABLE: TableDef = {
  name: 'contacts',
  columns: [
    { name: 'organization', type: 'TEXT', index: true },
    { name: 'ownerId', type: 'TEXT', index: true },
    { name: 'ownerName', type: 'TEXT', index: true },
    { name: 'name', type: 'TEXT', index: true },
    { name: 'phoneNumber', type: 'TEXT', index: true },
    { name: 'email', type: 'TEXT' },
    { name: 'status', type: 'TEXT', index: true },
    { name: 'isSpam', type: 'INTEGER', index: true },
    { name: 'keysText', type: 'TEXT' },
    { name: 'createdOn', type: 'TEXT', index: true },
    { name: 'modifiedOn', type: 'TEXT', index: true },
  ],
  ftsColumns: ['name', 'phoneNumber', 'email', 'keysText'],
};

export function extractTags(keys: string[] | string | undefined): string[] {
  if (!keys) return [];
  if (Array.isArray(keys)) return keys.filter(Boolean).map((t) => String(t).trim());
  if (typeof keys === 'string') {
    return keys.split('#').map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

// `#tag1#tag2#` so a tag filter can match with LIKE '%#tag#%' without false partial hits.
export function buildKeysText(keys: string[] | string | undefined): string {
  const tags = extractTags(keys);
  return tags.length ? `#${tags.join('#')}#` : '';
}

export function contactId(c: any): string {
  return String(c.id || c.Id || c.phoneNumber || c.PhoneNumber || '');
}

export function mapContactRow(c: any): MappedRow | null {
  const id = contactId(c);
  if (!id) return null;
  return {
    id,
    columns: {
      organization: c.organization || c.Organization || '',
      ownerId: c.ownerId || '',
      ownerName: (c.ownerName || '').trim(),
      name: c.name || c.Name || '',
      phoneNumber: c.phoneNumber || c.PhoneNumber || '',
      email: c.email || '',
      status: (c.lastConversationStatus || c.conversationStatus || '').trim(),
      isSpam: c.isSpam ? 1 : 0,
      keysText: buildKeysText(c.keys),
      createdOn: c.createdOn || '',
      modifiedOn: c.modifiedOn || c.lastMessageTime || c.createdOn || '',
    },
    data: c as Contact,
    updatedAt: Date.now(),
  };
}
