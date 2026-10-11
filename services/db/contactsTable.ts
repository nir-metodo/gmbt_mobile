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
    // Consent: 1 = agreed, 0 = opted out / not agreed, NULL = no record (mirrors contact.consent).
    {
      name: 'consent',
      type: 'INTEGER',
      backfill: {
        value: "CASE WHEN json_extract(data,'$.consent') IN (1,'true') THEN 1 ELSE 0 END",
        where: "json_extract(data,'$.consent') IS NOT NULL",
      },
    },
    // 0 only when the contact is explicitly unread (isRead === false); everything else counts as read.
    {
      name: 'isRead',
      type: 'INTEGER',
      backfill: { value: '0', where: "json_extract(data,'$.isRead') IN (0,'false')" },
    },
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
      consent:
        c.consent === true || c.consent === 'true' ? 1 : c.consent === false || c.consent === 'false' ? 0 : null,
      isRead: c.isRead === false || c.isRead === 'false' ? 0 : 1,
    },
    data: c as Contact,
    updatedAt: Date.now(),
  };
}
