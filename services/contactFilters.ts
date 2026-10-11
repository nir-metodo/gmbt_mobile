// Contact list filter model, SQL builder and (de)serialization for saved views.
//
// The shape of a saved view mirrors the WEB Contacts screen (`ContactViews` collection:
// `filters: { owners, keys, advancedFilters }`) so views created on web load in the app and vice
// versa. Mobile-only extras (mine / unread / sort) live in `filters.mobile`, which the web ignores.

export type ContactSort = 'name' | 'createdOn' | 'modifiedOn' | '';
export type TagsOperator = 'any' | 'all' | 'none';
export type ConsentBucket = 'agreed' | 'notAgreed' | 'noRecord' | 'spam';
export type ConvStatusBucket = 'Open' | 'In Process' | 'Closed';

export type DateOperator =
  | 'between'
  | 'before'
  | 'after'
  | 'equals'
  | 'is_today'
  | 'is_yesterday'
  | 'is_in_last_x_days'
  | 'x_days_ago'
  | 'not_in_last_x_days';

// Same fields/operators as the web advanced-filter date objects.
export interface DateFilter {
  operator: DateOperator;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysValue: string;
}

export interface ContactFilterState {
  owners: string[]; // owner display names
  mine: boolean; // owned by the signed-in user
  unassigned: boolean; // no owner
  tags: string[];
  tagsOperator: TagsOperator;
  consent: ConsentBucket[];
  convStatus: ConvStatusBucket[];
  created: DateFilter | null;
  activity: DateFilter | null; // last activity (modifiedOn / last message)
  hasEmail: boolean | null;
  unread: boolean;
  sortBy: ContactSort;
}

export const EMPTY_FILTERS: ContactFilterState = {
  owners: [],
  mine: false,
  unassigned: false,
  tags: [],
  tagsOperator: 'any',
  consent: [],
  convStatus: [],
  created: null,
  activity: null,
  hasEmail: null,
  unread: false,
  sortBy: '',
};

export function makeDateFilter(operator: DateOperator, daysValue = '', startDate = '', endDate = ''): DateFilter {
  return { operator, daysValue, startDate, endDate };
}

// ── Built-in views ──────────────────────────────────────────────────────────────────────────────
export type BuiltInViewId = '__all' | '__mine' | '__unassigned' | '__new' | '__unread' | '__optedout';

export const BUILTIN_VIEW_FILTERS: Record<BuiltInViewId, ContactFilterState> = {
  __all: EMPTY_FILTERS,
  __mine: { ...EMPTY_FILTERS, mine: true },
  __unassigned: { ...EMPTY_FILTERS, unassigned: true },
  __new: { ...EMPTY_FILTERS, created: makeDateFilter('is_in_last_x_days', '7') },
  __unread: { ...EMPTY_FILTERS, unread: true },
  __optedout: { ...EMPTY_FILTERS, consent: ['notAgreed'] },
};

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export interface ResolvedRange {
  from?: string; // inclusive ISO
  to?: string; // exclusive ISO
  includeEmpty?: boolean; // a missing date counts as a match (used by "no activity for X days")
}

export function resolveDateFilter(f: DateFilter | null | undefined, now = new Date()): ResolvedRange | null {
  if (!f) return null;
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const days = parseInt(f.daysValue, 10);
  const start = parseLocalDate(f.startDate);
  const end = parseLocalDate(f.endDate);
  const iso = (d: Date) => d.toISOString();
  switch (f.operator) {
    case 'is_today':
      return { from: iso(today), to: iso(tomorrow) };
    case 'is_yesterday':
      return { from: iso(addDays(today, -1)), to: iso(today) };
    case 'is_in_last_x_days':
      if (isNaN(days)) return null;
      return { from: iso(addDays(today, -days)), to: iso(tomorrow) };
    case 'x_days_ago': {
      if (isNaN(days)) return null;
      const d = addDays(today, -days);
      return { from: iso(d), to: iso(addDays(d, 1)) };
    }
    case 'not_in_last_x_days':
      if (isNaN(days)) return null;
      return { to: iso(addDays(today, -days)), includeEmpty: true };
    case 'before':
      return start ? { to: iso(startOfDay(start)) } : null;
    case 'after':
      return start ? { from: iso(addDays(startOfDay(start), 1)) } : null;
    case 'equals':
      return start ? { from: iso(startOfDay(start)), to: iso(addDays(startOfDay(start), 1)) } : null;
    case 'between': {
      if (!start && !end) return null;
      const r: ResolvedRange = {};
      if (start) r.from = iso(startOfDay(start));
      if (end) r.to = iso(addDays(startOfDay(end), 1));
      return r;
    }
    default:
      return null;
  }
}

function dateFilterActive(f: DateFilter | null): boolean {
  const r = resolveDateFilter(f);
  return !!r && (r.from != null || r.to != null);
}

// Number of filter groups that are switched on (sort is not a filter).
export function countActiveFilterGroups(f: ContactFilterState): number {
  let n = 0;
  if (f.owners.length > 0 || f.mine || f.unassigned) n++;
  if (f.tags.length > 0) n++;
  if (f.consent.length > 0) n++;
  if (f.convStatus.length > 0) n++;
  if (dateFilterActive(f.created)) n++;
  if (dateFilterActive(f.activity)) n++;
  if (f.hasEmail !== null) n++;
  if (f.unread) n++;
  return n;
}

function normDate(d: DateFilter | null): unknown {
  if (!dateFilterActive(d)) return null;
  return [d!.operator, d!.daysValue || '', d!.startDate || '', d!.endDate || ''];
}

// Canonical key so two states that mean the same thing compare equal (used to highlight the
// active view tab and to detect "has unsaved/custom filters").
export function filterKey(f: ContactFilterState, includeSort = true): string {
  return JSON.stringify([
    [...f.owners].sort(),
    f.mine,
    f.unassigned,
    [...f.tags].sort(),
    f.tags.length > 0 ? f.tagsOperator : 'any',
    [...f.consent].sort(),
    [...f.convStatus].sort(),
    normDate(f.created),
    normDate(f.activity),
    f.hasEmail,
    f.unread,
    includeSort ? f.sortBy : '',
  ]);
}

export function filtersEqual(a: ContactFilterState, b: ContactFilterState, includeSort = true): boolean {
  return filterKey(a, includeSort) === filterKey(b, includeSort);
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────────
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

// "050-123 4567" / "+972 50 123 4567" / "0501234567"  ->  national digits "501234567".
function nationalDigits(digits: string): string {
  if (digits.startsWith('972')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// Returns phone-search info when the WHOLE query looks like a phone number (>= 3 digits).
export function parsePhoneQuery(q: string): { digits: string; national: string; anchored: boolean } | null {
  const raw = q.trim();
  if (!/^[+\d][\d\s\-().]*$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 3) return null;
  const anchored = digits.startsWith('0') || digits.startsWith('972');
  const national = nationalDigits(digits);
  if (!national) return null;
  return { digits, national, anchored };
}

export function searchTokens(q: string): string[] {
  return q.trim().split(/\s+/).filter(Boolean);
}

function buildSearchClause(q: string): { sql: string; params: string[] } | null {
  const raw = q.trim();
  if (!raw) return null;
  const params: string[] = [];

  const phone = parsePhoneQuery(raw);
  if (phone) {
    // Phone typed in ANY format: local 05x… / 972… / with dashes. Stored numbers are normally
    // international (972501234567), so a local/international prefix is matched anchored and
    // anything else (middle/last digits) as a substring.
    const nat = likeEscape(phone.national);
    const parts: string[] = ["name LIKE ? ESCAPE '\\'"];
    params.push(`%${likeEscape(raw)}%`);
    if (phone.anchored) {
      parts.push("phoneNumber LIKE ? ESCAPE '\\'", "phoneNumber LIKE ? ESCAPE '\\'");
      params.push(`972${nat}%`, `0${nat}%`);
    } else {
      parts.push("phoneNumber LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(phone.digits)}%`);
    }
    return { sql: `(${parts.join(' OR ')})`, params };
  }

  // Free text: every word must match name / email / tag / owner (or phone digits) - substring.
  const clauses: string[] = [];
  for (const tok of searchTokens(raw)) {
    const like = `%${likeEscape(tok)}%`;
    const parts = [
      "name LIKE ? ESCAPE '\\'",
      "email LIKE ? ESCAPE '\\'",
      "keysText LIKE ? ESCAPE '\\'",
      "ownerName LIKE ? ESCAPE '\\'",
    ];
    params.push(like, like, like, like);
    const digits = tok.replace(/\D/g, '');
    if (digits.length >= 3 && /^[+\d()-]+$/.test(tok)) {
      parts.push("phoneNumber LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(nationalDigits(digits))}%`);
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }
  return clauses.length ? { sql: clauses.join(' AND '), params } : null;
}

// ── SQL builder ─────────────────────────────────────────────────────────────────────────────────
export interface WhereContext {
  organization: string;
  scopeOwnerId?: string; // data-visibility = own
  currentUserId?: string;
  search?: string;
}

export function buildContactWhere(
  f: ContactFilterState,
  ctx: WhereContext,
): { where: string; params: (string | number | null)[] } {
  const where: string[] = ['organization = ?'];
  const params: (string | number | null)[] = [ctx.organization];

  if (ctx.scopeOwnerId) {
    where.push('ownerId = ?');
    params.push(ctx.scopeOwnerId);
  }

  // Owner group: mine / unassigned / named owners are OR-ed together.
  const ownerParts: string[] = [];
  if (f.mine && ctx.currentUserId) {
    ownerParts.push('ownerId = ?');
    params.push(ctx.currentUserId);
  }
  if (f.unassigned) ownerParts.push("COALESCE(TRIM(ownerName), '') = ''");
  if (f.owners.length > 0) {
    ownerParts.push(`ownerName IN (${f.owners.map(() => '?').join(',')})`);
    params.push(...f.owners);
  }
  if (ownerParts.length > 0) where.push(`(${ownerParts.join(' OR ')})`);

  if (f.tags.length > 0) {
    const tagConds = f.tags.map(() => "COALESCE(keysText, '') LIKE ? ESCAPE '\\'");
    const tagParams = f.tags.map((t) => `%#${likeEscape(t)}#%`);
    if (f.tagsOperator === 'all') {
      where.push(`(${tagConds.join(' AND ')})`);
    } else if (f.tagsOperator === 'none') {
      where.push(`NOT (${tagConds.join(' OR ')})`);
    } else {
      where.push(`(${tagConds.join(' OR ')})`);
    }
    params.push(...tagParams);
  }

  if (f.consent.length > 0) {
    const parts = f.consent.map((b) =>
      b === 'agreed'
        ? 'consent = 1'
        : b === 'notAgreed'
          ? 'consent = 0'
          : b === 'noRecord'
            ? 'consent IS NULL'
            : 'isSpam = 1',
    );
    where.push(`(${parts.join(' OR ')})`);
  }

  if (f.convStatus.length > 0) {
    const parts: string[] = [];
    if (f.convStatus.includes('Open')) parts.push("LOWER(COALESCE(status,'')) = 'open'");
    if (f.convStatus.includes('In Process')) parts.push("LOWER(COALESCE(status,'')) = 'in process'");
    // Empty / legacy status is bucketed as Closed (same as the web + chats sidebar).
    if (f.convStatus.includes('Closed'))
      parts.push("LOWER(COALESCE(status,'')) NOT IN ('open','in process')");
    where.push(`(${parts.join(' OR ')})`);
  }

  const addRange = (column: string, df: DateFilter | null) => {
    const r = resolveDateFilter(df);
    if (!r || (r.from == null && r.to == null)) return;
    const parts: string[] = [];
    if (r.from != null) {
      parts.push(`${column} >= ?`);
      params.push(r.from);
    }
    if (r.to != null) {
      parts.push(`${column} < ?`);
      params.push(r.to);
    }
    let cond = parts.join(' AND ');
    if (r.includeEmpty) cond = `(${cond} OR COALESCE(${column},'') = '')`;
    where.push(`(${cond})`);
  };
  addRange('createdOn', f.created);
  addRange('modifiedOn', f.activity);

  if (f.hasEmail === true) where.push("TRIM(COALESCE(email,'')) != ''");
  if (f.hasEmail === false) where.push("TRIM(COALESCE(email,'')) = ''");
  if (f.unread) where.push('COALESCE(isRead, 1) = 0');

  const search = buildSearchClause(ctx.search || '');
  if (search) {
    where.push(search.sql);
    params.push(...search.params);
  }

  return { where: where.join(' AND '), params };
}

export function buildContactOrder(sortBy: ContactSort): string {
  if (sortBy === 'name') return 'name COLLATE NOCASE ASC';
  if (sortBy === 'createdOn') return 'createdOn DESC';
  return 'modifiedOn DESC';
}

// ── Saved-view (de)serialization (web-compatible) ───────────────────────────────────────────────
const WEB_DATE_DEFAULT = { operator: 'between', startDate: '', endDate: '', daysValue: '' };

export function toWebViewFilters(f: ContactFilterState): any {
  const dateOut = (d: DateFilter | null) => (dateFilterActive(d) ? { ...d } : { ...WEB_DATE_DEFAULT });
  return {
    owners: [],
    keys: [],
    advancedFilters: {
      tags: {
        operator: f.tagsOperator === 'all' ? 'contains_all' : f.tagsOperator === 'none' ? 'not_contains' : 'contains_any',
        values: f.tags,
        logic: f.tagsOperator === 'all' ? 'AND' : 'OR',
      },
      owner: {
        operator: 'contains_any',
        values: f.owners,
        hasValue: f.unassigned && f.owners.length === 0 ? false : null,
      },
      status: { values: f.consent },
      conversationStatus: { values: f.convStatus },
      createdDate: dateOut(f.created),
      dateRange: dateOut(f.activity),
      email: { operator: 'contains', value: '', hasValue: f.hasEmail },
    },
    // Ignored by the web; restores the mobile-only options (and an owners+unassigned combo).
    mobile: { mine: f.mine, unassigned: f.unassigned, unread: f.unread, sortBy: f.sortBy },
  };
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

function parseDate(d: any): DateFilter | null {
  if (!d || typeof d !== 'object') return null;
  const df: DateFilter = {
    operator: (d.operator || 'between') as DateOperator,
    startDate: String(d.startDate || ''),
    endDate: String(d.endDate || ''),
    daysValue: String(d.daysValue ?? ''),
  };
  return dateFilterActive(df) ? df : null;
}

// Tolerant of web-created views (which carry extra fields we don't support: dynamic fields,
// related-entity filters, name/phone text filters - those are ignored here).
export function fromWebViewFilters(filters: any): ContactFilterState {
  const f = filters && typeof filters === 'object' ? filters : {};
  const adv = f.advancedFilters && typeof f.advancedFilters === 'object' ? f.advancedFilters : {};
  const mobile = f.mobile && typeof f.mobile === 'object' ? f.mobile : {};

  const owners = Array.from(new Set([...asStrArray(f.owners), ...asStrArray(adv.owner?.values)]));
  const tags = Array.from(new Set([...asStrArray(f.keys), ...asStrArray(adv.tags?.values)]));
  const op = adv.tags?.operator;
  const tagsOperator: TagsOperator =
    op === 'contains_all' || adv.includeAllTags ? 'all' : op === 'not_contains' ? 'none' : 'any';

  const consent = asStrArray(adv.status?.values).filter((v) =>
    ['agreed', 'notAgreed', 'noRecord', 'spam'].includes(v),
  ) as ConsentBucket[];
  const convStatus = asStrArray(adv.conversationStatus?.values).filter((v) =>
    ['Open', 'In Process', 'Closed'].includes(v),
  ) as ConvStatusBucket[];

  const hv = adv.email?.hasValue;
  const sortBy: ContactSort = ['name', 'createdOn', 'modifiedOn'].includes(mobile.sortBy) ? mobile.sortBy : '';

  return {
    owners,
    mine: !!mobile.mine,
    unassigned: mobile.unassigned != null ? !!mobile.unassigned : adv.owner?.hasValue === false,
    tags,
    tagsOperator,
    consent,
    convStatus,
    created: parseDate(adv.createdDate),
    activity: parseDate(adv.dateRange),
    hasEmail: hv === true || hv === false ? hv : null,
    unread: !!mobile.unread,
    sortBy,
  };
}
