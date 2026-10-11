/**
 * Pure helpers for the WhatsApp Campaigns feature (list status derivation, run-result funnel,
 * template/variable resolution). Ported 1:1 from the web (Campaigns.js / PreviewRun.js /
 * CampaignResult.js / TemplatesHandler.js) — keep behaviour identical to avoid drift.
 */
import type {
  RunRecipient,
  WaCampaign,
  WaRunResult,
  WaScheduledEntry,
  WaTemplate,
  WaTemplateComponent,
} from '../../../services/api/campaigns';

// ───────────────────────────── numbers / dates ─────────────────────────────

export const num = (v: any): number => {
  const x = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(x) ? x : 0;
};

/** "dd/MM/yyyy HH:mm:ss" (the campaign's own timezone wall-clock) → Date, or ISO/Date fallback. */
export function parseRunAtLocal(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = new Date(
      parseInt(m[3], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[1], 10),
      parseInt(m[4], 10),
      parseInt(m[5], 10),
      parseInt(m[6] || '0', 10) || 0,
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Scheduled-run `runAt` entries may be tz-less UTC strings ("2026-01-01T10:00:00") — treat as UTC. */
export function parseRunAtAsUtc(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(value) && !hasTz ? `${value}Z` : value;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
  } catch {
    return 'Asia/Jerusalem';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date (device wall-clock) → "dd/MM/yyyy HH:mm:ss" — the format the backend's ConvertToUtc parses. */
export function formatRunAt(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function formatWhen(date: Date | string | null | undefined, he: boolean): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(he ? 'he-IL' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

// ───────────────────────────── run results ─────────────────────────────

export interface FunnelCounts {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  skipped: number;
  stopped: number;
  unknown: number;
  unsubscribed: number;
}

const emptyFunnel = (): FunnelCounts => ({
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
  stopped: 0,
  unknown: 0,
  unsubscribed: 0,
});

const isSkippedStatus = (s: string) => s.startsWith('skipped');

function effectiveStatus(r: any): string {
  const s = String(r?.Status || r?.status || '').toLowerCase();
  if (s === 'queued') return 'pending';
  if (s) return s;
  if (r?.MessageId) return 'sent';
  return 'unknown';
}

/** WhatsApp statuses are hierarchical: read ⊃ delivered ⊃ sent (same as CampaignResult.js). */
export function computeRunStats(run: WaRunResult): FunnelCounts & { total: number } {
  const c = emptyFunnel();
  const s = run?.CampaignResultSummary || {};
  const rows = Array.isArray(run?.CampaignRecipientData) ? run.CampaignRecipientData : null;
  if (rows && rows.length > 0) {
    rows.forEach((rd) => {
      const st = effectiveStatus(rd);
      if (rd?.UnsubscribedFromBroadcast) c.unsubscribed++;
      if (isSkippedStatus(st)) c.skipped++;
      else if (st === 'stopped') c.stopped++;
      else if (st === 'failed' || st === 'undelivered' || st === 'not delivered') c.failed++;
      else if (st === 'read') {
        c.read++;
        c.delivered++;
        c.sent++;
      } else if (st === 'delivered') {
        c.delivered++;
        c.sent++;
      } else if (st === 'sent') c.sent++;
      else if (st === 'pending') c.pending++;
      else c.unknown++;
    });
  } else {
    c.sent = num(s.NumberOfSentMessage);
    c.delivered = num(s.NumberOfDeliveredMessage);
    c.read = num(s.NumberOfReadMessage);
    c.failed = num(s.NumberOfFailureOutboundMessage);
    c.unsubscribed = num(s.NumberOfUnsubscribed);
  }
  const total = num(s.TotalContactsNumber) || rows?.length || 0;
  return { ...c, total };
}

export interface RunSummary {
  runs: number;
  lastRunAt?: string;
  lastStatus?: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  inProcess: boolean;
}

export function summarizeRuns(runs: WaRunResult[]): RunSummary {
  if (!runs || runs.length === 0) {
    return { runs: 0, total: 0, sent: 0, delivered: 0, read: 0, failed: 0, inProcess: false };
  }
  const last = runs[0]; // already sorted newest first
  const st = computeRunStats(last);
  return {
    runs: runs.length,
    lastRunAt: last.RunsAt,
    lastStatus: last.Status,
    total: st.total,
    sent: st.sent,
    delivered: st.delivered,
    read: st.read,
    failed: st.failed,
    inProcess: /process|queue|sending|pending/i.test(String(last.Status || '')),
  };
}

// ───────────────────────────── status derivation ─────────────────────────────

export type CampaignStatusKey = 'scheduled' | 'cancelled' | 'completed' | 'broken' | 'sent' | 'draft' | 'system';

export interface DerivedStatus {
  key: CampaignStatusKey;
  nextRun?: Date | null;
  runsDone?: number;
  totalRuns?: number;
  /** True when "draft vs sent" could not be proven yet (run history not loaded for this campaign). */
  unresolved?: boolean;
}

export function findScheduledEntry(c: WaCampaign, entries: WaScheduledEntry[]): WaScheduledEntry | undefined {
  return entries.find((e) => e.CampaignId === c.campaingId);
}

const endCondOf = (o: any): { type: string; value: string } => {
  const ec = o?.EndCondition || o?.endCondition;
  return { type: String(ec?.Type ?? ec?.type ?? '').toLowerCase(), value: String(ec?.Value ?? ec?.value ?? '') };
};

export function deriveStatus(c: WaCampaign, entries: WaScheduledEntry[], summary?: RunSummary | null): DerivedStatus {
  if (c.isSystem) return { key: 'system' };

  const match = findScheduledEntry(c, entries);
  const cancelled =
    c.campaignStatus === 'Cancelled' || (!!match && (match.Status === 'cancelled' || match.status === 'cancelled'));
  const hasBulkEvidence = (c.lastBulkEnd ?? 0) > 0 || (Array.isArray(c.BulkHistory) && c.BulkHistory.length > 0);
  const ranBefore = hasBulkEvidence || (summary?.runs ?? 0) > 0;

  if (cancelled && (match || c.campaignTrigger === 'Scheduled')) return { key: 'cancelled' };

  if (match) {
    const history: string[] = Array.isArray(match.RunsHistory) ? match.RunsHistory : [];
    const now = new Date();
    const blocks =
      Array.isArray(c.ScheduledRuns) && c.ScheduledRuns.length > 0
        ? c.ScheduledRuns
        : Array.isArray(match.ScheduledRuns)
          ? match.ScheduledRuns
          : [];
    const eff = endCondOf(match).value && endCondOf(match).type ? endCondOf(match) : endCondOf(c);

    let completed = match.isCompleted === true;
    if (!completed && eff.type === 'count' && eff.value) {
      const max = parseInt(eff.value, 10);
      if (!isNaN(max) && history.length > 0 && history.length >= max) completed = true;
    }
    if (!completed && eff.type === 'until' && eff.value) {
      const until = new Date(eff.value);
      if (!isNaN(until.getTime()) && history.length > 0 && now > until) completed = true;
    }
    if (!completed && String(match.ScheduleType || c.scheduleType) === 'custom' && blocks.length > 0) {
      const allFired = history.length >= blocks.length;
      const allPassed = blocks.every((b: any) => {
        const t = parseRunAtAsUtc(b?.runAt);
        return !!t && t <= now;
      });
      if (allFired || (history.length > 0 && allPassed)) completed = true;
    }
    if (completed) return { key: 'completed', runsDone: history.length, totalRuns: blocks.length || undefined };

    // Next planned run: soonest future block, else interval after last run, else the first RunAt.
    let next: Date | null = null;
    for (const b of blocks as any[]) {
      const t = parseRunAtAsUtc(b?.runAt);
      if (t && t > now && (!next || t < next)) next = t;
    }
    if (!next) {
      const runAt = parseRunAtAsUtc(match.RunAt);
      const n = parseInt(String(match.IntervalNumber ?? 0), 10);
      const iv = String(match.Interval || '').toLowerCase();
      if (history.length > 0 && !isNaN(n) && n > 0) {
        const last = history.map((h) => new Date(h)).reduce((a, b) => (b > a ? b : a));
        const t = new Date(last);
        switch (iv) {
          case 'second': t.setSeconds(t.getSeconds() + n); break;
          case 'minute': t.setMinutes(t.getMinutes() + n); break;
          case 'hour': t.setHours(t.getHours() + n); break;
          case 'day': t.setDate(t.getDate() + n); break;
          case 'week': t.setDate(t.getDate() + 7 * n); break;
          case 'month': t.setMonth(t.getMonth() + n); break;
          case 'year': t.setFullYear(t.getFullYear() + n); break;
          default: break;
        }
        next = !isNaN(t.getTime()) && iv ? t : runAt;
      } else {
        next = runAt;
      }
    }
    return { key: 'scheduled', nextRun: next, runsDone: history.length, totalRuns: blocks.length || undefined };
  }

  // Trigger = Scheduled but no scheduled doc → broken schedule (nothing will fire).
  if (c.campaignTrigger === 'Scheduled') return { key: 'broken' };

  if (ranBefore) return { key: 'sent' };
  return { key: 'draft', unresolved: summary === undefined };
}

// ───────────────────────────── template analysis ─────────────────────────────

export interface TemplateInfo {
  header: WaTemplateComponent | null;
  body: WaTemplateComponent | null;
  footer: WaTemplateComponent | null;
  buttons: NonNullable<WaTemplateComponent['buttons']>;
  bodyText: string;
  headerFormat: string; // TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION | ''
  headerText: string;
  footerText: string;
  bodyVars: number[];
  /** Example label for each {{N}} (from components.body.example), used as a hint. */
  bodyHints: Record<number, string>;
  /** Reasons why creating a campaign with this template needs the web app (empty = fully supported). */
  unsupported: string[];
}

export function getBodyVarIndicesFromText(text: string): number[] {
  const matches = [...String(text || '').matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(matches.map((m) => parseInt(m[1], 10)))].sort((a, b) => a - b);
}

export function analyzeTemplate(t: WaTemplate | null | undefined, he: boolean): TemplateInfo {
  const comps: WaTemplateComponent[] = Array.isArray(t?.components) ? (t!.components as WaTemplateComponent[]) : [];
  const header = comps.find((c) => c.type === 'HEADER') || null;
  const body = comps.find((c) => c.type === 'BODY') || null;
  const footer = comps.find((c) => c.type === 'FOOTER') || null;
  const btnComp = comps.find((c) => c.type === 'BUTTONS') || null;
  const buttons = (btnComp?.buttons || []) as NonNullable<WaTemplateComponent['buttons']>;
  const bodyText = body?.text || '';
  const bodyVars = getBodyVarIndicesFromText(bodyText);
  const example = body?.example?.body_text?.[0] || [];
  const bodyHints: Record<number, string> = {};
  bodyVars.forEach((n, i) => {
    if (example[i]) bodyHints[n] = String(example[i]);
  });
  const headerFormat = header ? String(header.format || 'TEXT').toUpperCase() : '';

  const unsupported: string[] = [];
  if (header && headerFormat === 'TEXT' && /\{\{\d+\}\}/.test(header.text || '')) {
    unsupported.push(he ? 'כותרת טקסט עם משתנה' : 'a text header with a variable');
  }
  if (header && headerFormat === 'LOCATION') {
    unsupported.push(he ? 'כותרת מיקום' : 'a location header');
  }
  if (buttons.some((b) => b.type === 'URL' && /\{\{\d+\}\}/.test(b.url || ''))) {
    unsupported.push(he ? 'כפתור קישור דינמי' : 'a dynamic URL button');
  }
  if (buttons.some((b) => b.type === 'COPY_CODE' || b.type === 'OTP' || b.type === 'FLOW' || b.type === 'MPM' || b.type === 'CATALOG')) {
    unsupported.push(he ? 'כפתור מיוחד (קוד/Flow/קטלוג)' : 'a special button (code/Flow/catalog)');
  }
  if (comps.some((c) => c.type === 'CAROUSEL' || c.type === 'LIMITED_TIME_OFFER')) {
    unsupported.push(he ? 'קרוסלה / הצעה מוגבלת בזמן' : 'a carousel / limited-time offer');
  }

  return {
    header,
    body,
    footer,
    buttons,
    bodyText,
    headerFormat,
    headerText: header && headerFormat === 'TEXT' ? header.text || '' : '',
    footerText: footer?.text || '',
    bodyVars,
    bodyHints,
    unsupported,
  };
}

export const templateKey = (t: WaTemplate | null | undefined): string => String(t?.Id || t?.id || t?.name || '');

// ───────────────────────────── variable queries ─────────────────────────────

export type VarSource = 'text' | 'column' | 'phone';

export interface VarMapping {
  source: VarSource;
  value: string; // hard-coded text, or contact column key
}

/** Which {{N}} body placeholder a query fills (handles bodyVarIndex, dynamic_varN, {{N}} and bare "N"). */
export function queryBodyIndex(q: any): number | null {
  if (q == null) return null;
  if (q.bodyVarIndex != null && !Number.isNaN(Number(q.bodyVarIndex))) return Number(q.bodyVarIndex);
  const v = String(q.Variable || '');
  const dv = v.match(/dynamic_var(\d+)/);
  if (dv) return parseInt(dv[1], 10);
  const br = v.match(/\{+(\d+)\}+/);
  if (br) return parseInt(br[1], 10);
  const bare = v.match(/^(\d+)$/);
  if (bare) return parseInt(bare[1], 10);
  if (q.index != null && !Number.isNaN(Number(q.index))) return Number(q.index);
  return null;
}

export const isMediaOrButtonQuery = (q: any): boolean =>
  !!(
    q &&
    (q.isMediaUpload ||
      q.isFileUpload ||
      q.buttonType ||
      /dynamic_image|dynamic_video|dynamic_file|header_document|button\d+_dynamic_var/.test(String(q.Variable || '')))
  );

/** Body-variable query (not media / not button / not hidden). */
export const isBodyQuery = (q: any): boolean => !!q && !q.hidden && !isMediaOrButtonQuery(q);

export function mappingFromQuery(q: any): VarMapping {
  if (!q) return { source: 'text', value: '' };
  if (q.dataSource1 === 'recipient_phone') return { source: 'phone', value: '' };
  if (q.dataSource1 === 'data_source1_recipientSource') {
    return { source: 'column', value: String(q.parameters_ContactsColumns_Select || '') };
  }
  return { source: 'text', value: String(q.parameters_hardCoded_Text || '') };
}

/** Same shape TemplatesHandler stores for a body variable (the backend recognises `dynamic_var{N}`). */
export function buildBodyQuery(n: number, hint: string | undefined, m: VarMapping) {
  return {
    index: n,
    bodyVarIndex: n,
    Variable: `dynamic_var${n}`,
    variableLabel: hint || `{{${n}}}`,
    dataSource1:
      m.source === 'phone' ? 'recipient_phone' : m.source === 'column' ? 'data_source1_recipientSource' : 'data_source1_HardCoded',
    parameters_hardCoded_Text: m.source === 'text' ? m.value : '',
    parameters_ContactsColumns_Select: m.source === 'column' ? m.value : '',
    table1: '',
    field1: [] as string[],
    conditionOperator: '',
    dataSource2: '',
    table2: '',
    field2: [] as string[],
    retrieveFields: [] as string[],
  };
}

/**
 * Merge edited body mappings into the campaign's query list: body queries are rebuilt from `maps`,
 * every non-body query (media / buttons / hidden tracking) is preserved untouched; indexes re-numbered.
 */
export function mergeQueries(
  existing: any[] | undefined,
  bodyVars: number[],
  maps: Record<number, VarMapping>,
  hints: Record<number, string>,
): any[] {
  const keep = (existing || []).filter((q) => !isBodyQuery(q));
  const body = bodyVars.map((n) => buildBodyQuery(n, hints[n], maps[n] || { source: 'text', value: '' }));
  return [...keep, ...body].map((q, i) => ({ ...q, index: i + 1 }));
}

// ───────────────────────────── per-recipient preview ─────────────────────────────

function getRecipientField(record: any, field: string): string {
  if (!record || !field) return '';
  const direct = record[field];
  if (direct != null && typeof direct !== 'object') {
    const s = String(direct).trim();
    if (s) return s;
  }
  const lower = String(field).toLowerCase();
  for (const [k, val] of Object.entries(record)) {
    if (k.toLowerCase() === lower && val != null && typeof val !== 'object') {
      const s = String(val).trim();
      if (s) return s;
    }
  }
  return '';
}

export function resolveVarValueForRecipient(n: number, recipient: RunRecipient | null | undefined, queries: any[] | undefined): string {
  if (!recipient) return '';
  const pre = recipient.variables && recipient.variables['var' + n];
  if (pre != null && String(pre).trim()) return String(pre);

  const q = (queries || []).find((qq) => isBodyQuery(qq) && queryBodyIndex(qq) === n);
  if (!q) return '';
  const ds = q.dataSource1;
  if (ds === 'recipient_phone') return recipient.phoneNumber || recipient.phone || '';
  if (ds === 'data_source1_HardCoded') return q.parameters_hardCoded_Text || '';
  if (ds === 'data_source1_recipientSource') {
    let col = q.parameters_ContactsColumns_Select;
    if (col) {
      const isFirstWord = String(col).toLowerCase().startsWith('firstword:');
      if (isFirstWord) col = String(col).slice('firstword:'.length).trim();
      const take = (v: any) => (isFirstWord ? String(v).trim().split(/\s+/)[0] || '' : String(v));
      const fromRow = recipient.rowData && (recipient.rowData as any)[col];
      if (fromRow != null && String(fromRow).trim()) return take(fromRow);
      const fromField = getRecipientField(recipient, col);
      if (fromField) return take(fromField);
    }
    return '';
  }
  return q.parameters_hardCoded_Text || '';
}

/** Replace each {{N}} with the recipient's value; unresolved placeholders stay visible (never blanked). */
export function buildResolvedBody(rawBody: string, queries: any[] | undefined, recipient: RunRecipient | null | undefined): string {
  if (!rawBody || !recipient) return rawBody;
  let text = rawBody;
  getBodyVarIndicesFromText(rawBody).forEach((n) => {
    const val = resolveVarValueForRecipient(n, recipient, queries);
    if (val) text = text.replace(new RegExp(`\\{\\{${n}\\}\\}`, 'g'), val);
  });
  return text;
}

// ───────────────────────────── misc ─────────────────────────────

/** Tiny in-memory cache so route screens can reuse the list's campaign objects without re-fetching. */
const campaignCache = new Map<string, WaCampaign>();
export const cacheCampaigns = (list: WaCampaign[]) => {
  campaignCache.clear();
  list.forEach((c) => campaignCache.set(c.campaingId, c));
};
export const getCachedCampaign = (id: string) => campaignCache.get(id);
export const upsertCachedCampaign = (c: WaCampaign) => {
  if (c?.campaingId) campaignCache.set(c.campaingId, c);
};

export const campaignTemplateId = (c: WaCampaign): string =>
  String(c.wabaTemplateId || c.fbTemplateID || c.wabaTemplate?.Id || c.wabaTemplate?.id || '');

export function formatWabaDailyLimit(lim: { DailyLimit?: number | string; Tier?: string }): string {
  const dl = Number(lim?.DailyLimit);
  if (dl === -1) return '∞';
  if (Number.isFinite(dl) && dl > 0) return dl.toLocaleString();
  const tier = String(lim?.Tier || '').toUpperCase();
  if (tier.includes('100K') || tier.includes('100000')) return '100,000';
  if (tier.includes('10K') || tier.includes('10000')) return '10,000';
  if (tier.includes('2K') || tier.includes('2000') || tier.includes('1K') || tier.includes('1000')) return '2,000';
  if (tier.includes('250')) return '250';
  if (tier.includes('50')) return '50';
  if (tier.includes('UNLIMITED')) return '∞';
  return '2,000';
}
