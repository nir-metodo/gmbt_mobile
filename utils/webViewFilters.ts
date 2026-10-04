/**
 * Port of the web Sidebar's saved-view filter model (gmbt_frontend/src/components/General/Sidebar.js:
 * normalizeFilters / buildFacetPredicates / combineFacets) so the mobile chat list understands the
 * SAME view definitions the web saves — saved views, org-wide overrides of the built-in views and the
 * built-in views themselves. Keep the semantics identical to the web.
 */

export type WebViewFilters = {
  openConversations: boolean;
  myConversations: boolean;
  unassigned: boolean;
  botOwned: boolean;
  slaBreached: boolean;
  alsoInclude: string[];
  alsoIncludeStatus: string[];
  inactiveDays: number;
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
  /** Mobile-only extra (web has no equivalent): 'active7' | 'active30' | 'inactive7' | 'inactive30'. */
  activityFilter: string;
};

const ALSO_ELIGIBLE_FACETS = ['unassigned', 'myConversations', 'unread', 'notReviewedByHuman', 'openConversations', 'internalMessages', 'botOwned'];
const ALWAYS_AND_FACETS = new Set(['status', 'category', 'owner', 'contactGroup', 'leadStage', 'caseStage', 'inactiveDays', 'lastMsgFrom', 'lastMsgTo']);

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
    f.alsoInclude.length || f.inactiveDays || f.lastMsgFrom || f.lastMsgTo || f.internalMessages ||
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
};

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
  if (f.lastMsgFrom) {
    add('lastMsgFrom', (c) => {
      const t = lastMsgTs(c);
      const from = new Date(f.lastMsgFrom).getTime();
      return t !== null && !Number.isNaN(from) && t >= from;
    });
  }
  if (f.lastMsgTo) {
    add('lastMsgTo', (c) => {
      const t = lastMsgTs(c);
      const to = new Date(f.lastMsgTo).getTime();
      return t !== null && !Number.isNaN(to) && t <= to + 86400000 - 1;
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
    add('leadStage', (c) => {
      const stageId = c?.leadStageId || c?.leadStage || ctx.contactLeadMap?.[phoneDigits(c)]?.stageId || '';
      return !!stageId && f.leadStage.includes(stageId);
    });
  }
  if (f.caseStage.length) {
    add('caseStage', (c) => {
      const arr = ctx.contactCaseMap?.[phoneDigits(c)];
      return !!arr && arr.some((ci) => f.caseStage.includes(ci.stageId));
    });
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
