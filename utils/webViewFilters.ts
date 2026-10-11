/**
 * Port of the web Sidebar's saved-view filter model (gmbt_frontend/src/components/General/Sidebar.js:
 * normalizeFilters / buildFacetPredicates / combineFacets) so the mobile chat list understands the
 * SAME view definitions the web saves — saved views, org-wide overrides of the built-in views and the
 * built-in views themselves. Keep the semantics identical to the web.
 */

import { getConversationWaiting, MessageSlaConfig } from './messageSla';

export type WebViewFilters = {
  openConversations: boolean;
  myConversations: boolean;
  unassigned: boolean;
  botOwned: boolean;
  slaBreached: boolean;
  alsoInclude: string[];
  alsoIncludeStatus: string[];
  inactiveDays: number;
  activeWithinDays: number;
  lastMsgFrom: string;
  lastMsgTo: string;
  internalMessages: boolean;
  unread: boolean;
  notReviewedByHuman: boolean;
  category: string[];
  status: string[];
  owner: string[];
  contactGroup: string[];
  leadStage: string[];
  caseStage: string[];
  logic: 'AND' | 'OR';
  facetOps: Record<string, 'AND' | 'OR'>;
  /**
   * Mobile-only in-memory extra (legacy mobile-saved views may still carry it): 'active7' | 'active30' |
   * 'inactive7' | 'inactive30'. NEVER persisted — toPersistableWebFilters() translates it to the web's
   * activeWithinDays / inactiveDays so the view also works on the web.
   */
  activityFilter: string;
};

const ALSO_ELIGIBLE_FACETS = ['unassigned', 'myConversations', 'unread', 'notReviewedByHuman', 'openConversations', 'internalMessages', 'botOwned'];
const ALWAYS_AND_FACETS = new Set(['status', 'category', 'owner', 'contactGroup', 'leadStage', 'caseStage', 'inactiveDays', 'activeWithinDays', 'lastMsgFrom', 'lastMsgTo']);

// The system "bot" owners (Gambot + Gambot AI) — same ids as the web.
const GAMBOT_OWNER_IDS = ['gambot', 'gambot-ai', 'Tfyt1ZdPsGN5gMty8XQa3YrP22g1', '4Y1MxCp8x1UkYc1y1dkRkKzQiflK'];

const asArray = (v: any): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);

export function normalizeWebFilters(raw: any): WebViewFilters {
  const f = raw || {};
  return {
    openConversations: !!f.openConversations,
    myConversations: !!f.myConversations,
    unassigned: !!f.unassigned,
    botOwned: !!f.botOwned,
    slaBreached: !!f.slaBreached,
    alsoInclude: Array.isArray(f.alsoInclude) ? f.alsoInclude.filter((k: string) => ALSO_ELIGIBLE_FACETS.includes(k)) : [],
    alsoIncludeStatus: Array.isArray(f.alsoIncludeStatus) ? f.alsoIncludeStatus.filter((s: string) => ['Open', 'In Process', 'Closed'].includes(s)) : [],
    inactiveDays: Number(f.inactiveDays) > 0 ? Number(f.inactiveDays) : 0,
    activeWithinDays: Number(f.activeWithinDays) > 0 ? Number(f.activeWithinDays) : 0,
    lastMsgFrom: typeof f.lastMsgFrom === 'string' ? f.lastMsgFrom : '',
    lastMsgTo: typeof f.lastMsgTo === 'string' ? f.lastMsgTo : '',
    internalMessages: !!f.internalMessages,
    unread: !!f.unread,
    notReviewedByHuman: !!f.notReviewedByHuman,
    category: asArray(f.category),
    status: asArray(f.status),
    owner: asArray(f.owner),
    contactGroup: Array.isArray(f.contactGroup) ? f.contactGroup : [],
    leadStage: Array.isArray(f.leadStage) ? f.leadStage : [],
    caseStage: Array.isArray(f.caseStage) ? f.caseStage : [],
    logic: f.logic === 'OR' ? 'OR' : 'AND',
    facetOps: f.facetOps && typeof f.facetOps === 'object'
      ? Object.fromEntries(Object.entries(f.facetOps).filter(([, v]) => v === 'OR' || v === 'AND')) as Record<string, 'AND' | 'OR'>
      : {},
    activityFilter: typeof f.activityFilter === 'string' ? f.activityFilter : '',
  };
}

/** True when the filter set actually constrains anything. */
export function hasWebFilterConstraints(f: WebViewFilters | null): boolean {
  if (!f) return false;
  return !!(
    f.openConversations || f.myConversations || f.unassigned || f.botOwned || f.slaBreached ||
    f.alsoInclude.length || f.inactiveDays || f.activeWithinDays || f.lastMsgFrom || f.lastMsgTo || f.internalMessages ||
    f.unread || f.notReviewedByHuman || f.category.length || f.status.length || f.owner.length ||
    f.contactGroup.length || f.leadStage.length || f.caseStage.length || f.activityFilter
  );
}

// Firestore forbids map keys like "__mine__", so the web stores built-in override keys as "builtin_mine".
export function decodeOverridesMap(map: any): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(map || {}).forEach((k) => {
    const key = k.startsWith('builtin_') ? `__${k.slice('builtin_'.length)}__` : k;
    out[key] = map[k];
  });
  return out;
}

/** Inverse of decodeOverridesMap — "__mine__" → "builtin_mine" (Sidebar.js encodeOverridesMap). */
export function encodeOverridesMap(map: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  Object.keys(map || {}).forEach((k) => {
    const m = /^__(.+)__$/.exec(k);
    out[m ? `builtin_${m[1]}` : k] = map[k];
  });
  return out;
}

/**
 * The exact key set the web's normalizeFilters() emits (nothing mobile-only), so a view / override saved
 * from the app is read by the web 1:1. The mobile-only `activityFilter` is translated into the web's
 * activeWithinDays / inactiveDays instead of being persisted.
 */
export function toPersistableWebFilters(f: WebViewFilters): Record<string, any> {
  const { activityFilter, ...rest } = f;
  const out: Record<string, any> = { ...rest };
  const m = /^(active|inactive)(\d+)$/.exec(activityFilter || '');
  if (m) {
    const days = Number(m[2]);
    if (m[1] === 'active' && !(out.activeWithinDays > 0)) out.activeWithinDays = days;
    if (m[1] === 'inactive' && !(out.inactiveDays > 0)) out.inactiveDays = days;
  }
  return out;
}

const getOwnerId = (c: any): string => c?.ownerId || c?.OwnerId || '';
export const isUnassignedChat = (c: any): boolean => !getOwnerId(c);
export const isBotOwnedChat = (c: any): boolean => {
  const oid = getOwnerId(c);
  if (GAMBOT_OWNER_IDS.includes(oid)) return true;
  const nm = String(c?.ownerName || c?.OwnerName || '').toLowerCase();
  return nm === 'gambot' || nm.startsWith('gambot');
};

// Same 3-bucket normalisation as the web: anything that isn't Open / In Process counts as Closed.
const statusBucket = (raw: any): 'Open' | 'In Process' | 'Closed' => {
  const s = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'open' || s === 'פתוח') return 'Open';
  if (s === 'in_process' || s === 'in_progress' || s === 'inprocess' || s === 'בטיפול') return 'In Process';
  return 'Closed';
};

const lastMsgTs = (c: any): number | null => {
  const t = new Date(c?.lastMessageTime || c?.time).getTime();
  return Number.isNaN(t) ? null : t;
};

const phoneDigits = (c: any): string => String(c?.phoneNumber || c?.id || '').replace(/\D/g, '');

type Ctx = {
  meId: string;
  contactLeadMap?: Record<string, { stageId: string }>;
  contactCaseMap?: Record<string, { stageId: string }[]>;
  /** Chat response-SLA config — needed by the "בחריגה" (slaBreached) facet, same as the web. */
  messageSla?: MessageSlaConfig | null;
};

// Phone → map lookup tolerant of local-vs-international formats (0501234567 ↔ 972501234567) via the
// last 9 digits, like the web's lookupByPhone/phoneKeyVariants.
const last9 = (d: string) => (d.length > 9 ? d.slice(-9) : d);
function makePhoneLookup<T>(map?: Record<string, T>): (c: any) => T | undefined {
  if (!map) return () => undefined;
  let idx: Record<string, T> | null = null;
  return (c) => {
    const d = phoneDigits(c);
    if (!d) return undefined;
    if (map[d]) return map[d];
    if (!idx) {
      idx = {};
      Object.keys(map).forEach((k) => { idx![last9(k)] = map[k]; });
    }
    return idx[last9(d)];
  };
}

// "yyyy-MM-dd" must be read as the user's LOCAL day (new Date('2026-10-07') is UTC midnight).
const localDayStart = (ymd: string) => new Date(`${ymd}T00:00:00`).getTime();
const localDayEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999`).getTime();

/** Builds the chat predicate for a view's filters, or null when nothing is constrained. */
export function buildWebFilterPredicate(f: WebViewFilters | null, ctx: Ctx): ((c: any) => boolean) | null {
  if (!f || !hasWebFilterConstraints(f)) return null;
  const { meId } = ctx;

  const simple: Record<string, (c: any) => boolean> = {
    openConversations: (c) => {
      const t = lastMsgTs(c);
      return t !== null && (Date.now() - t) / 3600000 <= 24;
    },
    myConversations: (c) => getOwnerId(c) === meId,
    unassigned: isUnassignedChat,
    botOwned: isBotOwnedChat,
    unread: (c) => c?.isRead === false || (c?.unreadCount || 0) > 0,
    notReviewedByHuman: (c) => c?.humanReviewed === false,
    internalMessages: (c) => (c?.usersWithUnreadInternalMessages || []).includes(meId),
  };

  const preds: { key: string; pred: (c: any) => boolean }[] = [];
  const add = (key: string, pred: (c: any) => boolean) => preds.push({ key, pred });

  if (f.openConversations) add('openConversations', simple.openConversations);
  if (f.myConversations) add('myConversations', simple.myConversations);
  if (f.unassigned) add('unassigned', simple.unassigned);
  if (f.botOwned) add('botOwned', simple.botOwned);
  if (f.owner.length) {
    add('owner', (c) => f.owner.some((tok) => {
      if (tok === '__me__') return getOwnerId(c) === meId;
      if (tok === '__unassigned__') return isUnassignedChat(c);
      // uID (web) — or an owner NAME (older mobile-saved views).
      return getOwnerId(c) === tok || c?.ownerName === tok;
    }));
  }
  if (f.internalMessages) add('internalMessages', simple.internalMessages);
  if (f.category.length) add('category', (c) => f.category.includes(c?.lastConversationCategory ?? c?.category));
  if (f.status.length) add('status', (c) => f.status.includes(statusBucket(c?.lastConversationStatus ?? c?.status)));
  if (f.unread) add('unread', simple.unread);
  if (f.notReviewedByHuman) add('notReviewedByHuman', simple.notReviewedByHuman);
  if (f.inactiveDays > 0) {
    add('inactiveDays', (c) => {
      const t = lastMsgTs(c);
      if (t === null) return true;
      return (Date.now() - t) / 86400000 >= f.inactiveDays;
    });
  }
  if (f.activeWithinDays > 0) {
    add('activeWithinDays', (c) => {
      const t = lastMsgTs(c);
      if (t === null) return false;
      return (Date.now() - t) / 86400000 <= f.activeWithinDays;
    });
  }
  if (f.lastMsgFrom) {
    add('lastMsgFrom', (c) => {
      const t = lastMsgTs(c);
      if (t === null) return false;
      const from = localDayStart(f.lastMsgFrom);
      if (Number.isNaN(from) || t < from) return false;
      if (!f.lastMsgTo) {
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        return t <= endOfToday.getTime();
      }
      return true;
    });
  }
  if (f.lastMsgTo) {
    add('lastMsgTo', (c) => {
      const t = lastMsgTs(c);
      if (t === null) return false;
      const to = localDayEnd(f.lastMsgTo);
      return !Number.isNaN(to) && t <= to;
    });
  }
  if (f.activityFilter) {
    add('activityFilter', (c) => {
      const t = lastMsgTs(c);
      if (t === null) return f.activityFilter.startsWith('inactive');
      const ageDays = (Date.now() - t) / 86400000;
      switch (f.activityFilter) {
        case 'active7': return ageDays <= 7;
        case 'active30': return ageDays <= 30;
        case 'inactive7': return ageDays > 7;
        case 'inactive30': return ageDays > 30;
        default: return true;
      }
    });
  }
  if (f.contactGroup.length) {
    add('contactGroup', (c) => {
      const keys = c?.keys || c?.searchKeys;
      return Array.isArray(keys) && f.contactGroup.some((g) => keys.includes(g));
    });
  }
  if (f.leadStage.length) {
    const leadOf = makePhoneLookup(ctx.contactLeadMap);
    add('leadStage', (c) => {
      const stageId = c?.leadStageId || c?.leadStage || leadOf(c)?.stageId || '';
      return !!stageId && f.leadStage.includes(stageId);
    });
  }
  if (f.caseStage.length) {
    const casesOf = makePhoneLookup(ctx.contactCaseMap);
    add('caseStage', (c) => {
      const arr = casesOf(c);
      return !!arr && arr.some((ci) => f.caseStage.includes(ci.stageId));
    });
  }
  // "בחריגה" — conversation-response SLA breached (same computation as the row's waiting badge).
  if (f.slaBreached) {
    add('slaBreached', (c) => getConversationWaiting(c, ctx.messageSla)?.level === 'breach');
  }
  // Additive "כלול גם" buckets — always OR'd on top of the AND group.
  f.alsoInclude.forEach((k) => {
    const base = simple[k];
    if (!base) return;
    const pred = f.alsoIncludeStatus.length
      ? (c: any) => base(c) && f.alsoIncludeStatus.includes(statusBucket(c?.lastConversationStatus ?? c?.status))
      : base;
    add(`also:${k}`, pred);
  });

  if (preds.length === 0) return null;

  const resolveOp = (key: string): 'AND' | 'OR' => {
    if (key.startsWith('also:')) return 'OR';
    if (ALWAYS_AND_FACETS.has(key)) return 'AND';
    if (f.facetOps[key]) return f.facetOps[key] === 'OR' ? 'OR' : 'AND';
    return f.logic === 'OR' ? 'OR' : 'AND';
  };
  const andPreds = preds.filter((p) => resolveOp(p.key) === 'AND').map((p) => p.pred);
  const orPreds = preds.filter((p) => resolveOp(p.key) === 'OR').map((p) => p.pred);

  return (c: any) => {
    const andOk = andPreds.length ? andPreds.every((p) => p(c)) : false;
    const orOk = orPreds.length ? orPreds.some((p) => p(c)) : false;
    if (andPreds.length && orPreds.length) return andOk || orOk;
    if (andPreds.length) return andOk;
    return orOk;
  };
}
