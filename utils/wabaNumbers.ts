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

/** The user's first assigned number, else the primary number ('' when there is none). */
export function defaultSenderNumberId(numbers: WabaNumberInfo[], assignedNums: string[] = []): string {
  const picked = assignedNums.length > 0
    ? numbers.find((n) => assignedNums.includes(numId(n)))
    : numbers.find(numIsPrimary);
  return numId(picked);
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

const messageMs = (msg: any): number => {
  const raw = msg?.timestamp || msg?.Timestamp || msg?.createdOn || msg?.createdAt || msg?.sentAt;
  return raw?._seconds ? raw._seconds * 1000 : new Date(raw || 0).getTime();
};

/**
 * Which connected number a message to this contact must go out from (same rule as the web composer):
 *  1. exactly ONE number has an active conversation (customer wrote on it in the last 24h) → that number;
 *  2. several are active → the one with the newest message;
 *  3. none active and the chat only ever happened on ONE number → that number;
 *  4. otherwise the PRIMARY number (or the user's default when the primary is not allowed for them).
 * Returns null when no message can be attributed to a number yet.
 */
export function pickSenderNumberId(
  messages: any[],
  numbers: WabaNumberInfo[],
  assignedNums: string[] = [],
  nowMs: number = Date.now(),
): string | null {
  const seen = new Set<string>();
  const active = new Set<string>();
  const newest: Record<string, number> = {};
  (messages || []).forEach((msg) => {
    const nid = inferMessageNumberId(msg, numbers);
    if (!nid) return;
    seen.add(nid);
    const ts = messageMs(msg);
    if (ts > 0 && ts >= (newest[nid] || 0)) newest[nid] = ts;
    if (String(msg?.direction || '').toLowerCase() === 'inbound' && ts > 0 && nowMs - ts < WINDOW_MS) active.add(nid);
  });
  if (seen.size === 0) return null;
  if (active.size === 1) return [...active][0];
  if (active.size > 1) return [...active].reduce((best, id) => ((newest[id] || 0) > (newest[best] || 0) ? id : best));
  if (seen.size === 1) return [...seen][0];
  const primaryId = getPrimaryNumberId(numbers);
  const primaryAllowed = !!primaryId && (assignedNums.length === 0 || assignedNums.includes(primaryId));
  return primaryAllowed ? primaryId : defaultSenderNumberId(numbers, assignedNums);
}
