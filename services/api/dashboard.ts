import AsyncStorage from '@react-native-async-storage/async-storage';
import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import { MessageSlaConfig, resolveBusinessHours } from '../../utils/messageSla';

// Dashboard + Reports data layer. Every endpoint and payload shape below is copied from the web app
// (src/components/Dashboard/Dashboard.js and src/components/Reports/*) so numbers match across clients.

const EP = {
  DRILLDOWN: '/api/Webhooks/GetDashboardDrilldown',
  TASK_STATS: '/api/Webhooks/GetTaskStatistics',
  STORE_DASHBOARD: '/api/Orders/GetStoreDashboardStats',
  ORG_USAGE: '/api/Webhooks/GetOrgUsageProfile',
  AI_STATS: '/api/Webhooks/GetAiResponsesStats',
  AI_REPORT: '/api/Webhooks/GenerateAiReport',
  CASE_SETTINGS: '/api/Webhooks/GetCaseSettings',
  WORKING_HOURS: '/api/Webhooks/GetWorkingHours',
  TEMPLATE_SEND_STATS: '/api/Webhooks/GetTemplateSendStats',
  BUTTON_CLICK_STATS: '/api/Webhooks/GetButtonClickStats',
  BULK_CLICK_STATS: '/api/Webhooks/GetBulkTemplateClickStats',
  ALL_TEMPLATES: '/api/Webhooks/GetAllTemplates',
  STORE_ORDERS: '/api/Orders/GetOrders',
  STORE_INVENTORY: '/api/Inventory/GetInventory',
  STORE_PURCHASE_ORDERS: '/api/PurchaseOrders/GetPurchaseOrders',
} as const;

/** The user context the dashboard scoping rules depend on (see Dashboard.js `isAdmin` / `isAdminUser`). */
export interface DashboardScope {
  org: string;
  uid: string;
  userName?: string;
  /** Org-wide picture (admin, or full data visibility everywhere). */
  isAdmin: boolean;
  /** Real admin — org-wide financials (payments) are limited to them. */
  isAdminUser: boolean;
  /** getDataVisibility(user, feature) */
  visibility: (feature: string) => string;
}

const role = (s: DashboardScope) => (s.isAdmin ? 'admin' : 'user');

// ── Headline cards ───────────────────────────────────────────────────────────────────────────────

export interface MessagesHeadline {
  total: number;
  sent: number;
  received: number;
  delivered: number;
  scoped?: boolean;
  monthly: { month: string; sent: number; received: number }[];
  [k: string]: any;
}
export interface AiUsage {
  used: number;
  limit: number;
  unit?: string;
}

export async function fetchMessagesHeadline(s: DashboardScope): Promise<{ messages: MessagesHeadline | null; aiUsage: AiUsage | null }> {
  const res = await axiosInstance.post(ENDPOINTS.GET_DASHBOARD_STATS, { organizationName: s.org, userId: s.uid, userRole: role(s) });
  const m = res.data?.messages;
  const messages =
    m && (m.total > 0 || m.sent > 0 || m.received > 0)
      ? { ...m, monthly: Array.isArray(res.data?.monthlyMessageData) ? res.data.monthlyMessageData : [] }
      : null;
  const au = res.data?.aiUsage;
  const aiUsage = au && typeof au.limit === 'number' && au.limit > 0 ? au : null;
  return { messages, aiUsage };
}

export async function fetchContactsHeadline(s: DashboardScope): Promise<any | null> {
  const res = await axiosInstance.post(ENDPOINTS.GET_CONTACT_GROWTH, { organizationName: s.org, userId: s.uid, userRole: role(s) });
  const d = res.data;
  return d && d.totalContacts > 0 ? d : null;
}

export async function fetchLeadsHeadline(s: DashboardScope): Promise<any | null> {
  const res = await axiosInstance.post(ENDPOINTS.GET_LEADS_DASHBOARD, { organization: s.org, userRole: role(s) });
  const d = res.data;
  // byStage lists every pipeline stage (even with 0 leads), so it must NOT count as "has leads".
  const has =
    d &&
    ((d.totalOpen || 0) > 0 ||
      (d.wonThisMonth || 0) > 0 ||
      (d.lostThisMonth || 0) > 0 ||
      (d.recentLeads || []).length > 0 ||
      (d.byStage || []).some((st: any) => (st.count || 0) > 0));
  return has ? d : null;
}

export async function fetchCasesHeadline(s: DashboardScope): Promise<{ total: number } | null> {
  const res = await axiosInstance.post(ENDPOINTS.GET_CASES, {
    organization: s.org,
    dataVisibility: s.visibility('cases'),
    userId: s.uid,
    pageNumber: 1,
    pageSize: 1,
  });
  const total =
    res.data?.TotalCount || res.data?.totalCount || (Array.isArray(res.data?.Cases) ? res.data.Cases.length : 0) || 0;
  return total > 0 ? { total } : null;
}

export interface TaskHeadline {
  overdueTasks: number;
  dueToday: number;
  inProgress: number;
  active: number;
  total: number;
  [k: string]: any;
}
export async function fetchTasksHeadline(s: DashboardScope): Promise<TaskHeadline | null> {
  const res = await axiosInstance.post(EP.TASK_STATS, {
    organizationName: s.org,
    userId: s.isAdmin ? null : s.uid,
    userRole: role(s),
    user: { userId: s.uid, userName: s.userName },
  });
  const st = res.data?.statistics;
  if (!st) return null;
  const active = (st.overdueTasks || 0) + (st.dueToday || 0) + (st.inProgress || 0);
  const total = st.totalTasks ?? st.total ?? active;
  return active > 0 || total > 0 ? { ...st, active, total } : null;
}

export async function fetchQuotesHeadline(s: DashboardScope): Promise<{ count: number; value: number; approved: number } | null> {
  const res = await axiosInstance.post(ENDPOINTS.GET_ALL_QUOTES, {
    organization: s.org,
    dataVisibility: s.visibility('quotes'),
    userId: s.uid,
  });
  let list: any[] = Array.isArray(res.data) ? res.data : [];
  if (s.visibility('quotes') === 'own') {
    list = list.filter((q) => q.createdBy === s.uid || q.salesPersonId === s.uid);
  }
  if (list.length === 0) return null;
  const value = list.reduce((sum, q) => sum + (parseFloat(q.totalAmount || q.total || q.value || 0) || 0), 0);
  const approved = list.filter((q) => ['approved', 'accepted', 'paid'].includes((q.status || '').toLowerCase())).length;
  return { count: list.length, value, approved };
}

export async function fetchPaymentsHeadline(s: DashboardScope): Promise<{ count: number; paid: number; pending: number; paidAmount: number } | null> {
  // Org-wide financials: real admins only, and only while a clearing provider is ACTIVE.
  if (!s.isAdminUser) return null;
  const cs = await axiosInstance.post(ENDPOINTS.GET_CLEARING_SETTINGS, { organization: s.org });
  if (!cs.data?.settings?.activeProvider) return null;
  const res = await axiosInstance.post(ENDPOINTS.GET_PAYMENT_TRANSACTIONS, { organization: s.org });
  const list = res.data?.transactions || res.data?.Data || [];
  if (!Array.isArray(list) || list.length === 0) return null;
  const paid = list.filter((t: any) => t.status === 'paid');
  const pending = list.filter((t: any) => t.status === 'pending').length;
  const paidAmount = paid.reduce((sum: number, t: any) => sum + (parseFloat(t.amount) || 0), 0);
  return { count: list.length, paid: paid.length, pending, paidAmount };
}

export async function fetchOrdersHeadline(s: DashboardScope): Promise<{ count: number; revenue: number; active: number } | null> {
  if (!s.isAdmin && s.visibility('orders') !== 'all') return null;
  const res = await axiosInstance.post(EP.STORE_DASHBOARD, { organization: s.org });
  const o = res.data?.stats?.orders;
  return o && (o.count > 0 || o.totalRevenue > 0)
    ? { count: o.count || 0, revenue: o.totalRevenue || 0, active: o.activeCount ?? o.active ?? 0 }
    : null;
}

/** Chats waiting past the response SLA (manager sees all, employees only their own — enforced server-side). */
export async function fetchSlaChats(s: DashboardScope): Promise<any[]> {
  const res = await axiosInstance.post(ENDPOINTS.GET_SLA_BREACHES, { organization: s.org, userRole: role(s) });
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchWhatsAppNumbers(org: string): Promise<any[]> {
  const res = await axiosInstance.get(`${ENDPOINTS.GET_WHATSAPP_NUMBERS}?organization=${org}`);
  return res.data?.Numbers || res.data?.numbers || [];
}

export async function fetchOrgUsers(org: string): Promise<{ id: string; name: string }[]> {
  const res = await axiosInstance.post(ENDPOINTS.GET_USERS, { organization: org });
  const raw = res.data;
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.users) ? raw.users : [];
  return list
    .map((u) => ({
      id: u.uID || u.userId || u.id || u.Id || '',
      name: u.FullName || u.UserName || u.name || u.displayName || u.email || u.uID || u.userId || '',
    }))
    .filter((u) => u.id);
}

// ── Drill-down (time-range aware breakdowns) ─────────────────────────────────────────────────────

export type DrillEntity = 'cases' | 'leads' | 'contacts' | 'messages' | 'tasks' | 'orders';

export interface DrillParams {
  org: string;
  entity: DrillEntity;
  dateFrom: string | null;
  dateTo: string | null;
  /** owner filter (user ids); empty = everyone in scope */
  owners: string[];
  uid: string;
  isAdmin: boolean;
  /** WhatsApp number id (multi-number orgs) */
  fromNumberId: string | null;
}

const DRILL_TTL_MS = 60 * 1000;
const drillCache = new Map<string, { ts: number; data: any }>();
const drillInflight = new Map<string, Promise<any>>();

const drillKey = (p: DrillParams) => JSON.stringify([p.org, p.entity, p.dateFrom, p.dateTo, p.owners, p.uid, p.isAdmin, p.fromNumberId]);

export function peekDrilldown(p: DrillParams): any | undefined {
  const hit = drillCache.get(drillKey(p));
  return hit && Date.now() - hit.ts < DRILL_TTL_MS ? hit.data : undefined;
}

export function clearDrilldownCache() {
  drillCache.clear();
}

/** Same payload as Dashboard.js loadDrill. Resolves `{}` on failure (the web renders zeros, never throws). */
export async function fetchDrilldown(p: DrillParams, force = false): Promise<any> {
  const key = drillKey(p);
  if (!force) {
    const hit = peekDrilldown(p);
    if (hit !== undefined) return hit;
    const inflight = drillInflight.get(key);
    if (inflight) return inflight;
  }
  const owners = p.owners.filter(Boolean);
  const req = axiosInstance
    .post(EP.DRILLDOWN, {
      organization: p.org,
      entity: p.entity,
      dateFrom: p.dateFrom || null,
      dateTo: p.dateTo || null,
      userId: owners.length ? owners.join(',') : p.uid,
      userRole: owners.length ? 'user' : p.isAdmin ? 'admin' : 'user',
      fromNumberId: p.fromNumberId || null,
    })
    .then((res) => {
      const data = res.data || {};
      drillCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .catch(() => ({}))
    .finally(() => {
      drillInflight.delete(key);
    });
  drillInflight.set(key, req);
  return req;
}

// ── Org usage profile (which modules the org really uses → hide empty report topics) ─────────────

export type OrgUsage = Record<string, boolean>;
const USAGE_TTL_MS = 30 * 60 * 1000;
const usageKey = (org: string) => `orgUsage_${org}`;

export async function getCachedOrgUsage(org: string): Promise<OrgUsage | null> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(usageKey(org))) || 'null');
    return raw?.usage || null;
  } catch {
    return null;
  }
}

/** Unknown / failed → null (the caller must then show everything, like the web does). */
export async function loadOrgUsage(org: string): Promise<OrgUsage | null> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(usageKey(org))) || 'null');
    if (raw?.usage && Date.now() - (raw.ts || 0) < USAGE_TTL_MS) return raw.usage;
  } catch {
    /* ignore */
  }
  try {
    const res = await axiosInstance.post(EP.ORG_USAGE, { organization: org, refresh: false });
    const usage = res.data?.usage;
    if (usage) {
      AsyncStorage.setItem(usageKey(org), JSON.stringify({ usage, ts: Date.now() })).catch(() => {});
      return usage;
    }
  } catch {
    /* unknown usage -> never hide anything */
  }
  return null;
}

/** true = in use, false = confirmed unused, undefined = unknown (treated as in use). */
export const isModuleUsed = (usage: OrgUsage | null | undefined, moduleKey: string): boolean =>
  usage && moduleKey in usage ? !!usage[moduleKey] : true;

// ── Reports: conversations / bots / AI ───────────────────────────────────────────────────────────

/** Web sends whole UTC days: `${from}T00:00:00Z` … `${to}T23:59:59Z`. */
const utcRange = (from: string, to: string) => ({ dateFrom: `${from}T00:00:00Z`, dateTo: `${to}T23:59:59Z` });

export async function fetchDailyConversationReport(org: string, from: string, to: string, fromNumberId?: string | null) {
  const payload: any = { organizationId: org, ...utcRange(from, to) };
  if (fromNumberId) payload.fromNumberId = fromNumberId;
  const res = await axiosInstance.post(ENDPOINTS.GET_DAILY_CONVERSATION_REPORT, payload);
  return res.data;
}

export async function fetchDailyBotSummary(org: string, from: string, to: string) {
  const res = await axiosInstance.post(ENDPOINTS.GET_DAILY_BOT_SUMMARY, { organizationId: org, ...utcRange(from, to) });
  return res.data;
}

export async function fetchAiResponsesStats(org: string, from: string, to: string) {
  // Plain dates → the backend treats them as whole Israel days (same as the rest of the report).
  const res = await axiosInstance.post(EP.AI_STATS, { organization: org, dateFrom: from, dateTo: to });
  return res.data;
}

/** CaseSettings.sla.messageResponse + org working hours -> the chat SLA config the web report uses (same as the chat list). */
export async function fetchMessageSlaConfig(org: string): Promise<MessageSlaConfig | null> {
  try {
    const cs = await axiosInstance.post(EP.CASE_SETTINGS, { organization: org });
    const raw = cs.data;
    const mr = raw?.sla?.messageResponse;
    if (!mr) return null;
    const wh = await axiosInstance.post(EP.WORKING_HOURS, { organization: org }).catch(() => null);
    const orgWH = wh?.data?.Data?.workingHours || wh?.data?.workingHours || null;
    const chatBh = mr.businessHours || raw?.sla?.businessHours;
    return { ...mr, businessHours: resolveBusinessHours(chatBh, orgWH) } as MessageSlaConfig;
  } catch {
    return null;
  }
}

export async function fetchMessagesByPhone(org: string, phone: string): Promise<any[]> {
  const res = await axiosInstance.post('/api/Webhooks/GetMessagesByPhoneNumber', {
    organizationiD: org,
    phoneNumber: phone,
  });
  return Array.isArray(res.data) ? res.data : [];
}

export async function generateAiReport(org: string, userId: string, prompt: string) {
  const res = await axiosInstance.post(EP.AI_REPORT, { organization: org, prompt, userId });
  return res.data;
}

// ── Reports: WhatsApp templates ──────────────────────────────────────────────────────────────────

export async function fetchTemplateSendStats(org: string, from: string | null, to: string | null) {
  const res = await axiosInstance.post(EP.TEMPLATE_SEND_STATS, { organization: org, dateFrom: from, dateTo: to });
  return res.data;
}

export async function fetchButtonClickStats(org: string, from: string | null, to: string | null) {
  const res = await axiosInstance.post(EP.BUTTON_CLICK_STATS, { organization: org, dateFrom: from, dateTo: to });
  return res.data;
}

export async function fetchAllTemplates(org: string): Promise<any[]> {
  const res = await axiosInstance.post(EP.ALL_TEMPLATES, { organization: org });
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchTemplateClickStats(org: string, templates: any[], from: string | null, to: string | null) {
  const isTrackingUrl = (url: any) => typeof url === 'string' && url.includes('gambot.azurewebsites.net/api/Webhooks/track');
  const tracked = templates.filter((t) =>
    t.components?.some((c: any) =>
      c.buttons?.some(
        (b: any) => b.trackClicks === true || b.trackClicks === 'true' || isTrackingUrl(b.url) || isTrackingUrl(b.originalUrl),
      ),
    ),
  );
  // Always call — the backend also scans org-wide for clicks whose tracking id no longer matches a template.
  const res = await axiosInstance.post(EP.BULK_CLICK_STATS, {
    organization: org,
    templateIds: tracked.map((t) => t.name || t.id),
    dateFrom: from,
    dateTo: to,
  });
  return res.data;
}

// ── Reports: store ───────────────────────────────────────────────────────────────────────────────

export async function fetchStoreReportData(org: string, from: string | null, to: string | null) {
  const [ord, inv, po] = await Promise.all([
    axiosInstance.post(EP.STORE_ORDERS, { organization: org, filters: {}, dateFrom: from || null, dateTo: to || null }).catch(() => ({ data: null })),
    axiosInstance.post(EP.STORE_INVENTORY, { organization: org }).catch(() => ({ data: null })),
    axiosInstance.post(EP.STORE_PURCHASE_ORDERS, { organization: org }).catch(() => ({ data: null })),
  ]);
  return {
    orders: Array.isArray(ord.data?.orders) ? ord.data.orders : Array.isArray(ord.data) ? ord.data : [],
    inventory: Array.isArray(inv.data?.items) ? inv.data.items : [],
    purchaseOrders: Array.isArray(po.data?.purchaseOrders) ? po.data.purchaseOrders : [],
  };
}
