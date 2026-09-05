// Message-response SLA (conversation layer) — display-only, computed client-side.
// Mirrors the web app's src/components/Chats/messageSla.js so the mobile inbox shows the same
// "waiting" badge on chats that exceeded the chat response SLA.
//
// The "waiting clock" = time since the customer's LAST message that hasn't been answered. If the
// last message is inbound (from the customer), they're waiting for a reply. Any reply — human OR
// bot — flips the last message to outbound and stops the clock (no extra contact fields needed).
//
// Config comes from CaseSettings.sla.messageResponse (fetched via GetCaseSettings); the defaults
// below make it work with zero configuration. Business hours (optional) come from GetWorkingHours.

export interface MessageSlaConfig {
  enabled?: boolean;
  warnMinutes?: number;
  breachMinutes?: number;
  statuses?: string[];
  businessHours?: { enabled?: boolean; schedule?: Record<string, DayConfig> | null } | null;
}

interface DayConfig {
  enabled?: boolean;
  start?: string;
  end?: string;
  lunchStart?: string;
  lunchEnd?: string;
}

export interface WaitingInfo {
  level: 'warn' | 'breach';
  minutes: number;
  sinceIso: string;
}

export const DEFAULT_MESSAGE_SLA: MessageSlaConfig = {
  enabled: true,
  warnMinutes: 180, // amber after 3h
  breachMinutes: 720, // red after 12h
  statuses: ['Open', 'In Process'],
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// "09:00" → minutes-since-midnight (or null when malformed).
function parseHM(s?: string): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// Ordered open segments for a day config (handles a single lunch cut-out), each [openMin, closeMin].
function daySegments(dayCfg?: DayConfig): Array<[number, number]> {
  if (!dayCfg || dayCfg.enabled === false) return [];
  const open = parseHM(dayCfg.start);
  const close = parseHM(dayCfg.end);
  if (open == null || close == null || close <= open) return [];
  const ls = parseHM(dayCfg.lunchStart);
  const le = parseHM(dayCfg.lunchEnd);
  if (ls != null && le != null && le > ls && ls >= open && le <= close) return [[open, ls], [le, close]];
  return [[open, close]];
}

// Working minutes between two epoch-ms timestamps, counting ONLY inside the weekly schedule's open
// windows (per-day enable, start/end, optional lunch). Times are interpreted in the device's local
// timezone (display-only chat clock). Falls back to plain elapsed time when no schedule.
export function elapsedBusinessMinutes(startMs: number, endMs: number, schedule?: Record<string, DayConfig> | null): number {
  if (!(endMs > startMs)) return 0;
  if (!schedule) return (endMs - startMs) / 60000;
  let total = 0;
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  for (let guard = 0; guard < 400; guard++) {
    const dayMidnight = d.getTime();
    if (dayMidnight > endMs) break;
    for (const [o, c] of daySegments(schedule[DAY_KEYS[d.getDay()]])) {
      const lo = Math.max(dayMidnight + o * 60000, startMs);
      const hi = Math.min(dayMidnight + c * 60000, endMs);
      if (hi > lo) total += (hi - lo) / 60000;
    }
    d.setDate(d.getDate() + 1);
  }
  return total;
}

// Normalizes the CaseSettings.sla.messageResponse.businessHours block (+ optionally the org
// WorkingHours) into a simple { enabled, schedule } the chat clock can consume. source='custom'
// uses the inline schedule; source='org' uses the passed-in org working hours.
export function resolveBusinessHours(
  bh: any,
  orgWorkingHours?: Record<string, DayConfig> | null
): { enabled: boolean; schedule: Record<string, DayConfig> | null } {
  if (!bh || bh.enabled === false) return { enabled: false, schedule: null };
  const src = bh.source || 'org';
  let schedule: Record<string, DayConfig> | null = null;
  if (src === 'custom' && bh.schedule) schedule = bh.schedule;
  else if (orgWorkingHours) schedule = orgWorkingHours;
  else schedule = bh.schedule || null;
  if (!schedule) return { enabled: false, schedule: null };
  return { enabled: true, schedule };
}

// Returns null (no badge) or { level: 'warn' | 'breach', minutes, sinceIso }.
// Only surfaces at/after the warning threshold to keep the UI clean.
export function getConversationWaiting(contact: any, cfg?: MessageSlaConfig | null): WaitingInfo | null {
  if (!contact) return null;
  const c: MessageSlaConfig = { ...DEFAULT_MESSAGE_SLA, ...(cfg || {}) };
  if (c.enabled === false) return null;

  // Status gate: never show for a closed conversation.
  const status = contact.lastConversationStatus || contact.status || '';
  if (status && String(status).toLowerCase() === 'closed') return null;
  // If a status list is configured and the contact has a real status, require membership.
  if (Array.isArray(c.statuses) && c.statuses.length > 0 && status) {
    const match = c.statuses.some((s) => String(s).toLowerCase() === String(status).toLowerCase());
    if (!match) return null;
  }

  const dir = String(contact.lastMessageDirection || '').toLowerCase();
  if (dir !== 'inbound') return null; // last message was a reply (human/bot) → not waiting
  const waitingSince = contact.lastMessageTime || contact.time || null;
  if (!waitingSince) return null;

  const t = new Date(waitingSince).getTime();
  if (isNaN(t)) return null;
  // Business-hours-aware clock: when enabled, only count time inside working hours so a message
  // that arrives after-hours doesn't silently breach overnight. Falls back to raw elapsed time.
  const bh = c.businessHours;
  const minutes = bh && bh.enabled && bh.schedule
    ? elapsedBusinessMinutes(t, Date.now(), bh.schedule)
    : (Date.now() - t) / 60000;
  if (minutes < 0) return null;

  if (minutes >= (c.breachMinutes || 720)) return { level: 'breach', minutes, sinceIso: waitingSince };
  if (minutes >= (c.warnMinutes || 180)) return { level: 'warn', minutes, sinceIso: waitingSince };
  return null;
}

// Compact human-readable elapsed time (e.g. "45m", "3h", "2d 4h").
export function formatWaiting(minutes: number, isRTL: boolean): string {
  const m = Math.max(0, Math.floor(minutes || 0));
  if (m < 60) return isRTL ? `${m} דק׳` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    if (rem) return isRTL ? `${h}ש׳ ${rem}ד׳` : `${h}h ${rem}m`;
    return isRTL ? `${h} שע׳` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const remH = h % 24;
  if (remH) return isRTL ? `${d}י׳ ${remH}ש׳` : `${d}d ${remH}h`;
  return isRTL ? `${d} ימים` : `${d}d`;
}
