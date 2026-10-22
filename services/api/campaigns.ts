/**
 * WhatsApp Campaigns API (mobile port of gmbt_frontend/src/components/Campaign/*).
 *
 * Uses literal '/api/Webhooks/...' paths on purpose (this module deliberately does not touch
 * constants/api.ts). Payload shapes mirror the web app exactly — see Campaigns.js / CampaignForm.js /
 * PreviewRun.js. Backend quirks handled here:
 *  - the campaign id property is spelled `campaingId` (sic);
 *  - write endpoints can answer HTTP 200 `{ Success:false, Message }` — surfaced as thrown Errors;
 *  - RunCampaign is a long request (background send) — it gets an explicit long timeout because
 *    axiosInstance's long-timeout rule is case-sensitive and does not match "RunCampaign".
 */
import axiosInstance from './axiosInstance';

// ───────────────────────────── Types ─────────────────────────────

export interface WaCampaign {
  campaingId: string;
  campaignName: string;
  campaignTrigger?: string; // 'Manually' | 'Scheduled'
  campaignStatus?: string; // '' | 'Waiting' | 'Cancelled'
  recipientSource?: string; // 'Contacts' | 'Excel'
  recipientSourceTable?: string;
  messageType?: string; // 'Template' | 'Regular'
  message?: string;
  wabaTemplateId?: string;
  fbTemplateID?: string;
  wabaTemplateName?: string;
  fromNumberId?: string;
  createdOn?: string;
  modifiedOn?: string;
  createdByName?: string;
  modifiedByName?: string;
  runAt?: string; // 'dd/MM/yyyy HH:mm:ss' in `timezone`
  timezone?: string;
  scheduleType?: string; // 'once' | 'repeated' | 'custom'
  interval?: string;
  intervalNumber?: number | string;
  EndCondition?: { Type?: string; Value?: string; type?: string; value?: string } | null;
  endCondition?: { Type?: string; Value?: string; type?: string; value?: string } | null;
  Recurrence?: any;
  AutoSplit?: boolean;
  BatchSize?: number;
  ScheduledRuns?: Array<{ runAt?: string; batchStart?: number; batchEnd?: number; batchNumber?: number; recipients?: number }> | null;
  ContactFilters?: { filters?: any[]; logic?: string } | null;
  ContactsQuery?: any;
  templateVariableQuery?: any[];
  lastBulkStart?: number;
  lastBulkEnd?: number;
  BulkHistory?: any[];
  isSystem?: boolean;
  ExcelData?: any;
  [key: string]: any;
}

export interface WaScheduledEntry {
  CampaignId: string;
  RunAt?: string;
  Status?: string;
  status?: string;
  isCompleted?: boolean;
  ScheduledCampaignId?: string;
  [key: string]: any;
}

export interface WaTemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string;
  text?: string;
  example?: { body_text?: string[][]; header_text?: string[]; header_handle?: string[] };
  buttons?: Array<{
    type: string;
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string[];
    /** Real destination of a click-tracked button (url is then our /track wrapper). */
    originalUrl?: string;
    trackClicks?: boolean;
    isStaticWithTracking?: boolean;
    isTrackingDestination?: boolean;
  }>;
}

export interface WaTemplate {
  id?: string;
  Id?: string;
  name: string;
  status?: string;
  category?: string;
  language?: string;
  components?: WaTemplateComponent[];
  variableMappingJson?: string;
  friendlyName?: string;
  [key: string]: any;
}

export interface WaNumber {
  PhoneNumberId: string;
  DisplayNumber: string;
  Label?: string;
  IsPrimary?: boolean;
}

export interface WaLimit {
  Success?: boolean;
  Tier?: string;
  DailyLimit?: number | string;
  QualityRating?: string;
  PhoneNumberId?: string;
  DisplayNumber?: string;
  WabaNumber?: string;
  Label?: string;
  IsPrimary?: boolean;
  Error?: string;
}

export interface BroadcastBank {
  balance: number;
  totalAvailable: number;
  remainingIncluded: number;
  includedPerMonth: number;
  usedThisCycle: number;
  pricePer1000: number;
  limitsConfigured: boolean;
  planName: string;
  isTrial: boolean;
  trialCap: number;
  hasPaymentToken: boolean;
}

export interface WaRecipientRow {
  PhoneNumber?: string;
  MessageId?: string;
  Status?: string;
  errorMessage?: string;
  buttonPressed?: string;
  ReplyToMessage?: boolean;
  PressButton?: boolean;
  PressLink?: boolean;
  UnsubscribedFromBroadcast?: boolean;
  [key: string]: any;
}

export interface WaRunResult {
  CampaignResultsId?: string;
  RunsAt?: string;
  RunsByName?: string;
  Status?: string;
  Source?: string;
  Error?: string;
  BulkStart?: number | null;
  BulkEnd?: number | null;
  CampaignResultSummary?: Record<string, any>;
  CampaignRecipientData?: WaRecipientRow[];
  [key: string]: any;
}

export interface ClickStats {
  templateId?: string;
  totalClicks?: number;
  buttonBreakdown?: Record<string, number> | null;
}

/** A recipient as used by the run flow (contact or Excel row). */
export interface RunRecipient {
  id?: string | number;
  phoneNumber: string;
  name?: string;
  consent?: boolean | null;
  consentType?: string;
  variables?: Record<string, string>;
  rowData?: Record<string, any>;
  saveAsContact?: boolean;
  contactFields?: any;
  phone?: string;
  [key: string]: any;
}

// ───────────────────────────── Helpers ─────────────────────────────

function asArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

/** Throws when the backend answered 200 with an explicit failure payload. */
function assertOk(data: any, fallback: string) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.Success === false || data.success === false) {
      throw new Error(data.Message || data.message || data.error || fallback);
    }
    if (data.error && typeof data.error === 'string' && data.Success === undefined && data.success === undefined) {
      throw new Error(data.error);
    }
  }
}

async function fetchContactFields(organization: string): Promise<Array<{ name: string; label: string; type: string }>> {
  try {
    const res = await axiosInstance.get('/api/Webhooks/GetContactFieldsForFiltering', {
      params: { organizationName: organization },
    });
    const seen = new Set<string>();
    const out: Array<{ name: string; label: string; type: string }> = [];
    asArray<any>(res.data).forEach((f) => {
      const name = String(f.Name || f.name || '');
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      out.push({ name, label: String(f.Label || f.label || name), type: String(f.Type || f.type || 'text') });
    });
    return out;
  } catch {
    return [];
  }
}

/** Run-campaign: the backend sends in the background, so allow a very long request. */
export const RUN_CAMPAIGN_TIMEOUT_MS = 300000;

// ───────────────────────────── API ─────────────────────────────

export const campaignsApi = {
  // ── List ──
  async getAll(organization: string): Promise<WaCampaign[]> {
    const res = await axiosInstance.get('/api/Webhooks/GetAllCampaigns', { params: { organizationID: organization } });
    const data = res.data;
    if (!Array.isArray(data)) {
      if (data?.error) throw new Error(String(data.error));
      return [];
    }
    return data
      .filter((c: any) => c && c.campaingId)
      .sort((a: any, b: any) => {
        const tb = new Date(b.modifiedOn || b.createdOn || 0).getTime() || 0;
        const ta = new Date(a.modifiedOn || a.createdOn || 0).getTime() || 0;
        return tb - ta;
      });
  },

  async getWaitingScheduled(organization: string): Promise<WaScheduledEntry[]> {
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetWaitingScheduledCampaignsByOrganization', { organization });
      return asArray<WaScheduledEntry>(res.data);
    } catch {
      return [];
    }
  },

  async getCampaignById(organization: string, campaignId: string): Promise<WaCampaign> {
    const res = await axiosInstance.post('/api/Webhooks/GetCampaignById', { organization, CampaignId: campaignId });
    if (res.data?.error) throw new Error(String(res.data.error));
    return res.data as WaCampaign;
  },

  // ── Templates ──
  async getTemplates(organization: string): Promise<WaTemplate[]> {
    const res = await axiosInstance.post('/api/Webhooks/GetAllTemplates', { organization });
    return asArray<WaTemplate>(res.data);
  },

  async getTemplateById(organization: string, templateId: string): Promise<WaTemplate | null> {
    // The web sends `organizationId`; we also send `organization` so either server-side key resolves.
    const res = await axiosInstance.post('/api/Webhooks/GetTemplateById', {
      organizationId: organization,
      organization,
      templateId,
    });
    const d = res.data;
    if (!d || typeof d !== 'object' || d.error) return null;
    return d as WaTemplate;
  },

  async getTemplateMediaUrl(organization: string, templateId: string): Promise<string> {
    try {
      const res = await axiosInstance.post('/api/webhooks/GetMediaByTemplateId', { organization, templateId });
      return res.data?.mediaUrl || '';
    } catch {
      return '';
    }
  },

  // ── Results ──
  async getResults(organization: string, campaignId: string): Promise<WaRunResult[]> {
    const res = await axiosInstance.post(
      '/api/Webhooks/GetCampaignResultByCmpaignId',
      { organization, campaignId },
      { timeout: 120000 },
    );
    const list = asArray<WaRunResult>(res.data);
    return list.sort((a, b) => new Date(b.RunsAt || 0).getTime() - new Date(a.RunsAt || 0).getTime());
  },

  async rebuildResults(organization: string, campaignId: string): Promise<void> {
    try {
      await axiosInstance.post('/api/Webhooks/RebuildCampaignResults', { organization, campaignId }, { timeout: 120000 });
    } catch {
      /* non-critical — same as web (.catch(() => null)) */
    }
  },

  async getClickStats(organization: string, templateKey: string): Promise<ClickStats | null> {
    if (!templateKey) return null;
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetBulkTemplateClickStats', {
        organization,
        templateIds: [templateKey],
      });
      const templates = asArray<ClickStats>(res.data?.templates);
      return templates.find((t) => t.templateId === templateKey) || templates[0] || null;
    } catch {
      return null;
    }
  },

  // ── Create / delete / schedule ──
  async createCampaign(
    organization: string,
    campaignData: Record<string, any>,
    user: { userId: string; userName: string },
  ): Promise<any> {
    const res = await axiosInstance.post('/api/Webhooks/CreateCampaign', { organization, campaignData, user });
    assertOk(res.data, 'Failed to save the campaign');
    return res.data;
  },

  async deleteCampaign(organization: string, campaignId: string): Promise<void> {
    const res = await axiosInstance.post('/api/Webhooks/DeleteCampaign', { organization, CampaignId: campaignId });
    assertOk(res.data, 'Failed to delete the campaign');
  },

  async cancelSchedule(organization: string, campaignId: string): Promise<void> {
    const res = await axiosInstance.post('/api/Webhooks/CancelCampaignSchedule', { organization, campaignId });
    assertOk(res.data, 'Failed to cancel the schedule');
  },

  async saveScheduledRuns(
    organization: string,
    campaignId: string,
    scheduledRuns: Array<{
      runAt: string;
      batchStart: number;
      batchEnd: number;
      batchNumber: number;
      recipients: number;
      weekday?: number;
      time?: string;
    }>,
    timezone: string,
    recurrence?: any,
  ): Promise<void> {
    const res = await axiosInstance.post('/api/Webhooks/SaveCampaignScheduledRuns', {
      organization,
      campaignId,
      scheduledRuns,
      timezone,
      recurrence: recurrence || undefined,
    });
    assertOk(res.data, 'Failed to schedule the campaign');
  },

  async saveBulkRange(organization: string, campaignId: string, bulkStart: number, bulkEnd: number): Promise<void> {
    await axiosInstance.post('/api/Webhooks/SaveCampaignBulkRange', { organization, campaignId, bulkStart, bulkEnd });
  },

  async resetBulkRange(organization: string, campaignId: string): Promise<void> {
    const res = await axiosInstance.post('/api/Webhooks/ResetCampaignBulkRange', { organization, campaignId });
    assertOk(res.data, 'Failed to reset bulk history');
  },

  // ── Run ──
  async runCampaign(organization: string, runCampaignData: Record<string, any>): Promise<any> {
    const res = await axiosInstance.post(
      '/api/Webhooks/RunCampaign',
      { organization, runCampaignData },
      { timeout: RUN_CAMPAIGN_TIMEOUT_MS },
    );
    assertOk(res.data, 'Failed to run the campaign');
    return res.data;
  },

  // ── Audience ──
  async executeAdvancedFilter(organization: string, filtersObject: any): Promise<RunRecipient[]> {
    const res = await axiosInstance.post(
      '/api/Webhooks/ExecuteAdvancedContactFilter',
      { organizationName: organization, filtersObject },
      { timeout: 180000 },
    );
    return asArray<any>(res.data).map((c) => ({
      ...c,
      id: c.id,
      phoneNumber: c.phoneNumber,
      name: c.name || c.phoneNumber,
    }));
  },

  async getAllContacts(organization: string): Promise<RunRecipient[]> {
    const res = await axiosInstance.post(
      '/api/Webhooks/GetAllContactsByOrg',
      { organizationiD: organization },
      { timeout: 180000 },
    );
    return asArray<any>(res.data).map((c) => ({ ...c, id: c.id, phoneNumber: c.phoneNumber, name: c.name || c.phoneNumber }));
  },

  async countContacts(organization: string, contactFilters: any): Promise<number> {
    const res = await axiosInstance.post('/api/Webhooks/CountContactsByFilter', {
      organization,
      contactFilters: contactFilters || null,
    });
    const n = Number(res.data?.count ?? res.data?.Count);
    return Number.isFinite(n) ? n : 0;
  },

  /** The actual contacts behind the audience count (same endpoint the web "show recipients" modal uses). */
  async previewContacts(
    organization: string,
    contactFilters: any,
    limit = 200,
  ): Promise<{ count: number; contacts: Array<{ phone: string; name: string }> }> {
    const body: any = { organization, limit };
    if (contactFilters) body.contactFilters = contactFilters;
    const res = await axiosInstance.post('/api/Webhooks/GetContactsByFilter', body);
    const d = res.data || {};
    return {
      count: Number(d.count ?? d.Count ?? 0) || 0,
      contacts: asArray(d.contacts).map((c: any) => ({ phone: String(c?.phone ?? ''), name: String(c?.name ?? '') })),
    };
  },

  async validateContactMapping(
    organization: string,
    contactFilters: any,
    columns: Array<{ varKey: string; label: string; column: string }>,
  ): Promise<Array<{ severity: string; message: string; label: string }>> {
    try {
      const res = await axiosInstance.post('/api/Webhooks/ValidateCampaignContactMapping', {
        organization,
        contactFilters: contactFilters || null,
        columns,
        sampleSize: 25,
      });
      return res.data?.Success ? asArray(res.data?.Data?.issues) : [];
    } catch {
      return [];
    }
  },

  // ── Sender / limits / bank ──
  async getWhatsAppNumbers(organization: string): Promise<WaNumber[]> {
    try {
      const res = await axiosInstance.get('/api/Webhooks/GetWhatsAppNumbers', { params: { organization } });
      const nums = res.data?.Numbers || res.data?.numbers || [];
      return asArray<any>(nums).map((n) => ({
        PhoneNumberId: n.PhoneNumberId || n.phoneNumberId || '',
        DisplayNumber: n.DisplayNumber || n.displayNumber || n.WabaNumber || '',
        Label: n.Label || n.label || '',
        IsPrimary: !!(n.IsPrimary ?? n.isPrimary),
      }));
    } catch {
      return [];
    }
  },

  async getWabaLimits(organization: string): Promise<WaLimit[]> {
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetWabaMessagingLimits', { organization });
      if (!res.data?.Success) return [];
      const list = asArray<WaLimit>(res.data?.Numbers);
      if (list.length > 0) return list;
      return res.data?.Data ? [res.data.Data as WaLimit] : [];
    } catch {
      return [];
    }
  },

  async getBroadcastBank(organization: string): Promise<BroadcastBank | null> {
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetBroadcastBankBalance', { organization });
      const d = res.data;
      if (!d?.success) return null;
      return {
        balance: d.balance ?? 0,
        totalAvailable: d.totalAvailable ?? 0,
        remainingIncluded: d.remainingIncluded ?? 0,
        includedPerMonth: d.includedPerMonth ?? 0,
        usedThisCycle: d.usedThisCycle ?? 0,
        pricePer1000: d.pricePer1000 ?? 0,
        limitsConfigured: !!d.limitsConfigured,
        planName: d.planName || '',
        isTrial: !!d.isTrial,
        trialCap: d.trialCap ?? 0,
        hasPaymentToken: !!d.hasPaymentToken,
      };
    } catch {
      return null;
    }
  },

  // ── Filter option sources ──
  async getTags(organization: string): Promise<string[]> {
    try {
      const res = await axiosInstance.get('/api/Webhooks/GetAllKeys', { params: { organizationID: organization } });
      return asArray<any>(res.data).map((t) => String(t)).filter(Boolean);
    } catch {
      return [];
    }
  },

  async getUsers(organization: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetAllUsersByOrg', { organization });
      return asArray<any>(res.data)
        .map((u) => ({
          id: String(u.uID || u.uid || ''),
          name: String(u.FullName || u.fullName || u.UserName || u.userName || u.Email || ''),
        }))
        .filter((u) => u.id && u.name);
    } catch {
      return [];
    }
  },

  /**
   * Contact columns usable as template-variable sources: the org's custom columns
   * (GetContactsColumnsByOrg) + the standard/custom filterable fields, plus the synthetic
   * "firstword:Name" (first name only) the backend resolver understands.
   */
  async getContactColumns(organization: string): Promise<Array<{ key: string; label: string }>> {
    const out: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    const add = (key: string, label?: string) => {
      const k = String(key || '').trim();
      if (!k || /^unauthorized/i.test(k) || seen.has(k.toLowerCase())) return;
      seen.add(k.toLowerCase());
      out.push({ key: k, label: label || k });
    };
    try {
      const res = await axiosInstance.post('/api/Webhooks/GetContactsColumnsByOrg', { organization });
      asArray<any>(res.data).forEach((c) => add(String(c)));
    } catch {
      /* fall through to the filterable fields */
    }
    const fields = await fetchContactFields(organization);
    fields.forEach((f) => add(f.name, f.label));
    ['name', 'email'].forEach((k) => add(k));
    const nameIdx = out.findIndex((c) => c.key.toLowerCase() === 'name');
    const first = { key: 'firstword:Name', label: 'firstword:Name' };
    if (nameIdx >= 0) out.splice(nameIdx + 1, 0, first);
    else out.push(first);
    return out;
  },

  getContactFields: fetchContactFields,
};
