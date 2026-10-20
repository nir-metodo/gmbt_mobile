import type { WabaNumberInfo } from '../types';

// Multi-number WhatsApp helpers — mirror the web (Sidebar.js / ChatContainer.js) so the app and the
// web agree on which number a conversation / message belongs to.

export const numId = (n?: WabaNumberInfo | null): string => (n?.PhoneNumberId || n?.phoneNumberId || '') as string;

export const numIsPrimary = (n?: WabaNumberInfo | null): boolean => !!(n?.IsPrimary || n?.isPrimary);

export const numDisplay = (n?: WabaNumberInfo | null): string =>
  (n?.DisplayNumber || n?.displayNumber || '') as string;

export const numLabel = (n?: WabaNumberInfo | null): string =>
  (n?.Label || n?.label || numDisplay(n) || numId(n).slice(-4)) as string;

export function getPrimaryNumberId(numbers: WabaNumberInfo[]): string {
  const primary = numbers.find(numIsPrimary);
  return primary ? numId(primary) : '';
}

/**
 * The number id(s) a conversation is scoped under. A conversation is tagged with the number(s) it
 * happened on (wabaPhoneNumberIds / lastFromNumberId). Tags pointing at a retired number (an org that
 * re-created its WABA) or no tag at all collapse to the PRIMARY line, exactly like the web, so history
 * never vanishes from a number-scoped view. Returns [] only when there is no primary either.
 */
export function effectiveChatNumberIds(chat: any, numbers: WabaNumberInfo[]): string[] {
  const current = new Set(numbers.map(numId).filter(Boolean));
  const primaryId = getPrimaryNumberId(numbers);
  const ids = chat?.wabaPhoneNumberIds;
  let tagged: string[] = [];
  if (Array.isArray(ids) && ids.length > 0) tagged = ids.filter(Boolean).map(String);
  else if (typeof ids === 'string' && ids) tagged = [ids];
  else if (chat?.wabaPhoneNumberId) tagged = [String(chat.wabaPhoneNumberId)];
  else if (chat?.lastFromNumberId) tagged = [String(chat.lastFromNumberId)];
  const known = tagged.filter((id) => current.has(id));
  if (known.length > 0) return known;
  return primaryId ? [primaryId] : [];
}

const digits = (s: any) => String(s || '').replace(/[\s\-+]/g, '');

/**
 * Which of the org's numbers a single message went through: sent FROM it (outbound) or received TO it
 * (inbound). Prefers the stored number id, falls back to matching the from/to display number.
 * Returns '' when it can't be attributed (legacy messages carry neither).
 */
export function inferMessageNumberId(msg: any, numbers: WabaNumberInfo[]): string {
  const stored = msg?.fromNumberId || msg?.wabaPhoneNumberId || msg?.phoneNumberId;
  if (stored) return String(stored);
  if (numbers.length <= 1) return '';
  const outgoing = (msg?.direction || '').toLowerCase() === 'outbound' || msg?.sentFromApp === true;
  const field = digits(outgoing ? msg?.from : msg?.to);
  if (!field) return '';
  const match = numbers.find((n) => {
    const d = digits(numDisplay(n));
    return !!d && (d === field || field.endsWith(d) || d.endsWith(field));
  });
  return match ? numId(match) : '';
}
