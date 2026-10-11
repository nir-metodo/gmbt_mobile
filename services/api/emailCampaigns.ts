import axiosInstance from './axiosInstance';
import { calendarApi, Connection } from './calendar';

/**
 * Email campaigns API — a port of the web app's Email/EmailCampaign* components.
 * Same endpoints / payloads as gmbt_frontend (EmailCampaigns.js, EmailCampaignEditor.js,
 * EmailCampaignPreview.js, EmailCampaignResults.js). The backend wraps most answers as `{ ok, ... }`
 * and reports failures in `error` with a 200 status, so every call here unwraps and throws.
 */

const W = '/api/Webhooks';

// ───────────────────────────── Types ─────────────────────────────

export type EmailContentSource = 'template' | 'inline' | 'html';
export type EmailTrigger = 'Manually' | 'Scheduled';

export interface EmailContactFilter {
  filterType: string; // 'group' | 'contactField' | (web-only types such as relatedRecord, campaign…)
  fieldName: string;
  operator: string;
  value: string;
  groupValue: string[];
  [extra: string]: any;
}

export interface EmailContactFilters {
  filters: EmailContactFilter[];
  logic: 'AND' | 'OR';
}

export interface EmailTemplateVariable {
  index: number;
  variable: string;
  dataSource: string; // '' | 'data_source1_HardCoded' | 'data_source2_ContactField'
  contactField: string;
  customTable: string;
  customTableField: string;
  hardCodedValue: string;
}

export const DS_HARDCODED = 'data_source1_HardCoded';
export const DS_CONTACT_FIELD = 'data_source2_ContactField';

export interface EmailTemplateInfo {
  id: string;
  name: string;
  subject: string;
  html: string;
  variables: string[];
}

export interface EmailCampaignListItem {
  id: string;
  name: string;
  trigger: string;
  recipientSource: string;
  templateId: string;
  provider: string;
  status: string;
  scheduleType: string;
  runAt: string;
  timezone: string;
  createdOn: string;
  modifiedOn: string;
  modifiedBy: string;
}

/** Everything the editor can save (and everything we must round-trip so an edit never wipes data). */
export interface EmailCampaignInput {
  name: string;
  trigger: EmailTrigger;
  recipientSource: 'Contacts' | 'Excel';
  templateId: string;
  templateVariables: EmailTemplateVariable[];
  contactFilters: EmailContactFilters | null;
  excelData: any | null;
  contentSource: EmailContentSource;
  inlineSubject: string;
  inlineBody: string;
  inlineAttachments: any[];
  provider: string;
  runAt: string; // 'dd/MM/yyyy HH:mm:ss' (the format the web scheduler sends)
  timezone: string; // IANA id
  scheduleType: string;
  interval: string;
  intervalNumber: number;
  endCondition: any | null;
}

export interface EmailCampaignDetails extends EmailCampaignInput {
  id: string;
  status: string;
}

export interface EmailPreviewRecipient {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** true = consented, false = opted out, undefined = unknown (same semantics as the web preview). */
  consent?: boolean;
}

export interface EmailCampaignPreviewData {
  campaignName: string;
  status: string;
  recipientSource: string;
  template: { name: string; subject: string; html: string } | null;
  recipients: EmailPreviewRecipient[];
  from: string;
  fromProvider: string;
}

export interface EmailBankState {
  totalAvailable: number;
  limitsConfigured: boolean;
  isTrial: boolean;
  trialCap: number;
  hasPaymentToken: boolean;
  planName: string;
}

export interface EmailRunResult {
  ok: boolean;
  resuming: boolean;
  blocked: boolean;
  message: string;
  recipientCount: number;
  error: string;
}

export interface EmailResultRecipient {
  email: string;
  name: string;
  status: string; // normalised to lower-case
  errorMessage: string;
  sentAt: string;
  openedAt: string;
  campaignRunId: string;
}

export interface EmailCampaignResults {
  campaign: { id: string; name: string; status: string; templateName: string; sentDate: string };
  recipients: EmailResultRecipient[];
}

export interface EmailClickStats {
  totalClicks: number;
}

export interface EmailContactFieldDef {
  name: string;
  label: string;
  type: string;
  options: string[] | null;
}

export interface EmailContactPreview {
  count: number;
  contacts: { phone: string; name: string }[];
}

export interface EmailUserInfo {
  userId: string;
  userName: string;
}

// ───────────────────────────── Helpers ─────────────────────────────

function unwrapOk(data: any, fallbackError: string): any {
  if (data && data.ok === false) throw new Error(data.error || fallbackError);
  return data;
}

function asArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function str(v: any): string {
  return v === null || v === undefined ? '' : String(v);
}

function parseFilters(raw: any): EmailContactFilters | null {
  if (!raw) return null;
  let filters: any[] = [];
  let logic: 'AND' | 'OR' = 'AND';
  if (Array.isArray(raw)) {
    filters = raw;
  } else if (Array.isArray(raw.filters)) {
    filters = raw.filters;
    logic = String(raw.logic || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
  }
  if (filters.length === 0) return null;
  return {
    logic,
    filters: filters.map((f: any) => ({
      ...f,
      filterType: str(f.filterType),
      fieldName: str(f.fieldName),
      operator: str(f.operator),
      value: str(f.value),
      groupValue: asArray<string>(f.groupValue).map(String),
    })),
  };
}

function parseVariables(raw: any): EmailTemplateVariable[] {
  return asArray(raw).map((v: any, i: number) => ({
    index: Number(v.index ?? i + 1),
    variable: str(v.variable),
    dataSource: str(v.dataSource),
    contactField: str(v.contactField),
    customTable: str(v.customTable),
    customTableField: str(v.customTableField),
    hardCodedValue: str(v.hardCodedValue),
  }));
}

function normalizeListItem(c: any): EmailCampaignListItem {
  return {
    id: str(c.CampaignId || c.Id),
    name: str(c.CampaignName),
    trigger: str(c.CampaignTrigger),
    recipientSource: str(c.RecipientSource) || 'Contacts',
    templateId: str(c.TemplateId),
    provider: str(c.Provider),
    status: str(c.Status) || 'Draft',
    scheduleType: str(c.ScheduleType),
    runAt: str(c.RunAt),
    timezone: str(c.Timezone),
    createdOn: str(c.CreatedOn),
    modifiedOn: str(c.ModifiedOn),
    modifiedBy: str(c.ModifiedByName),
  };
}

function normalizeDetails(c: any): EmailCampaignDetails {
  const source = c.ContentSource === 'inline' ? 'inline' : c.ContentSource === 'html' ? 'html' : 'template';
  const recipientSource = c.RecipientSource === 'Excel' ? 'Excel' : 'Contacts';
  return {
    id: str(c.CampaignId || c.Id),
    status: str(c.Status) || 'Draft',
    name: str(c.CampaignName),
    trigger: c.CampaignTrigger === 'Scheduled' ? 'Scheduled' : 'Manually',
    recipientSource,
    templateId: str(c.TemplateId),
    templateVariables: parseVariables(c.TemplateVariables),
    contactFilters: recipientSource === 'Excel' ? null : parseFilters(c.ContactFilters || c.CampaignFilters),
    excelData: c.ExcelData ?? null,
    contentSource: source,
    inlineSubject: str(c.InlineSubject),
    inlineBody: str(c.InlineBody),
    inlineAttachments: asArray(c.InlineAttachments),
    provider: str(c.Provider),
    runAt: str(c.RunAt),
    timezone: str(c.Timezone),
    scheduleType: str(c.ScheduleType) || 'once',
    interval: str(c.Interval),
    intervalNumber: Number(c.IntervalNumber || 0),
    endCondition: c.EndCondition ?? null,
  };
}

function buildSavePayload(organization: string, user: EmailUserInfo, input: EmailCampaignInput): any {
  const inlineLike = input.contentSource === 'inline' || input.contentSource === 'html';
  const scheduled = input.trigger === 'Scheduled' && !!input.runAt;
  return {
    Organization: organization,
    CampaignData: {
      CampaignName: input.name || '',
      CampaignTrigger: input.trigger,
      RecipientSource: input.recipientSource,
      ExcelData: input.recipientSource === 'Excel' ? input.excelData : null,
      TemplateId: input.contentSource === 'template' ? input.templateId || '' : '',
      ContentSource: input.contentSource,
      InlineSubject: inlineLike ? input.inlineSubject : '',
      InlineBody: inlineLike ? input.inlineBody : '',
      InlineAttachments: input.contentSource === 'inline' ? input.inlineAttachments : [],
      TemplateVariables: input.contentSource === 'template' ? input.templateVariables : [],
      ContactFilters: input.recipientSource === 'Excel' ? null : input.contactFilters,
      Provider: input.provider || '',
      RunAt: scheduled ? input.runAt : '',
      Timezone: input.timezone,
      ScheduleType: scheduled ? input.scheduleType || 'once' : 'once',
      Interval: scheduled ? input.interval : '',
      IntervalNumber: scheduled ? input.intervalNumber || 0 : 0,
      EndCondition: scheduled ? input.endCondition || null : null,
    },
    User: { UserId: user.userId || '', UserName: user.userName || '' },
  };
}

// ───────────────────────────── API ─────────────────────────────

export const emailCampaignsApi = {
  async list(organization: string): Promise<EmailCampaignListItem[]> {
    const res = await axiosInstance.get(`${W}/email-campaigns`, { params: { organizationName: organization } });
    const data = unwrapOk(res.data, 'Failed to load campaigns');
    return asArray(data?.campaigns).map(normalizeListItem);
  },

  async get(organization: string, campaignId: string): Promise<EmailCampaignDetails> {
    const res = await axiosInstance.get(`${W}/GetEmailCampaignById`, {
      params: { organizationName: organization, campaignId },
    });
    const data = unwrapOk(res.data, 'Failed to load campaign');
    if (!data?.campaign) throw new Error('Campaign not found');
    return normalizeDetails(data.campaign);
  },

  /** Create (no campaignId) or update. Returns the campaign id. Saving NEVER sends anything. */
  async save(
    organization: string,
    user: EmailUserInfo,
    input: EmailCampaignInput,
    campaignId?: string,
  ): Promise<string> {
    const payload = buildSavePayload(organization, user, input);
    if (campaignId) {
      payload.CampaignId = campaignId;
      const res = await axiosInstance.post(`${W}/UpdateEmailCampaign`, payload);
      unwrapOk(res.data, 'Failed to save campaign');
      return campaignId;
    }
    const res = await axiosInstance.post(`${W}/CreateEmailCampaign`, payload);
    const data = unwrapOk(res.data, 'Failed to create campaign');
    if (!data?.campaignId) throw new Error('Missing campaign id');
    return String(data.campaignId);
  },

  async remove(organization: string, campaignId: string): Promise<void> {
    const res = await axiosInstance.post(`${W}/DeleteEmailCampaign`, null, {
      params: { organizationName: organization, campaignId },
    });
    unwrapOk(res.data, 'Failed to delete campaign');
  },

  /** Client-side duplicate (the backend has no duplicate endpoint): a fresh DRAFT with the same content. */
  async duplicate(organization: string, user: EmailUserInfo, campaignId: string, copySuffix: string): Promise<string> {
    const d = await emailCampaignsApi.get(organization, campaignId);
    const { id: _id, status: _status, ...input } = d;
    return emailCampaignsApi.save(organization, user, {
      ...input,
      name: `${d.name} ${copySuffix}`.trim(),
      trigger: 'Manually',
      runAt: '',
      scheduleType: 'once',
      interval: '',
      intervalNumber: 0,
      endCondition: null,
    });
  },

  async getConnections(organization: string): Promise<Connection[]> {
    return calendarApi.getConnections(organization);
  },

  async getTemplates(organization: string): Promise<EmailTemplateInfo[]> {
    const res = await axiosInstance.get(`${W}/email-templates`, { params: { organizationName: organization } });
    const data = unwrapOk(res.data, 'Failed to load templates');
    const list = asArray(data?.templates ?? data?.Templates ?? (Array.isArray(data) ? data : []));
    return list.map((t: any) => ({
      id: str(t.Id || t.id),
      name: str(t.Name || t.name),
      subject: str(t.Subject || t.subject),
      html: str(t.HtmlContent || t.htmlContent || t.Body || t.body),
      variables: asArray(t.Variables || t.variables).map(String),
    }));
  },

  /** Contact tags/groups (the web filter row's "group" source). */
  async getTags(organization: string): Promise<string[]> {
    const res = await axiosInstance.get(`${W}/GetAllKeys`, { params: { organizationID: organization } });
    const raw = res.data;
    const list = Array.isArray(raw) ? raw : asArray(raw?.Data || raw?.data);
    const names = list.map((k: any) => (typeof k === 'string' ? k : str(k?.name || k?.Name))).filter(Boolean);
    return Array.from(new Set(names));
  },

  async getContactFields(organization: string): Promise<EmailContactFieldDef[]> {
    const res = await axiosInstance.get(`${W}/GetContactFieldsForFiltering`, {
      params: { organizationName: organization },
    });
    const list = asArray(res.data);
    const seen = new Set<string>();
    const out: EmailContactFieldDef[] = [];
    list.forEach((f: any) => {
      const name = str(f.Name || f.name);
      if (!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      const options = f.Options || f.options;
      out.push({
        name,
        label: str(f.Label || f.label) || name,
        type: str(f.Type || f.type).toLowerCase(),
        options: Array.isArray(options) ? options.map(String) : null,
      });
    });
    return out;
  },

  /** Contact columns usable as template variables (same source as the web variable mapper). */
  async getContactColumns(organization: string): Promise<string[]> {
    const res = await axiosInstance.post(`${W}/GetContactsColumnsByOrg`, { organization });
    return asArray<string>(res.data)
      .map(String)
      .filter((c) => c && !/^(Error:|Unauthorized)/i.test(c));
  },

  /** Live audience count (same call as the web "show recipients" button). No filters = all contacts. */
  async countContacts(organization: string, filters: EmailContactFilters | null, limit = 200): Promise<EmailContactPreview> {
    const body: any = { organization, limit };
    if (filters && filters.filters.length > 0) body.contactFilters = filters;
    const res = await axiosInstance.post(`${W}/GetContactsByFilter`, body);
    const d = res.data || {};
    return {
      count: Number(d.count || 0),
      contacts: asArray(d.contacts).map((c: any) => ({ phone: str(c.phone), name: str(c.name) })),
    };
  },

  async getPreview(organization: string, campaignId: string): Promise<EmailCampaignPreviewData> {
    const res = await axiosInstance.post(`${W}/email-campaigns/preview`, {
      OrganizationName: organization,
      CampaignId: campaignId,
    });
    const d = unwrapOk(res.data, 'Failed to load preview');
    const t = d?.template;
    return {
      campaignName: str(d?.campaign?.CampaignName),
      status: str(d?.campaign?.Status),
      recipientSource: str(d?.campaign?.RecipientSource),
      template: t
        ? { name: str(t.Name), subject: str(t.Subject), html: str(t.HtmlContent) }
        : null,
      recipients: asArray(d?.recipients).map((r: any) => {
        const consent = r.consent !== undefined ? r.consent : r.Consent;
        return {
          id: str(r.Id),
          name: str(r.Name),
          email: str(r.Email).trim(),
          phone: str(r.PhoneNumber),
          consent: typeof consent === 'boolean' ? consent : undefined,
        };
      }),
      from: str(d?.from),
      fromProvider: str(d?.fromProvider),
    };
  },

  async getBankState(organization: string): Promise<EmailBankState | null> {
    try {
      const res = await axiosInstance.post(`${W}/GetEmailBankBalance`, { organization });
      const d = res.data;
      if (!d?.success) return null;
      return {
        totalAvailable: Number(d.totalAvailable ?? 0),
        limitsConfigured: !!d.limitsConfigured,
        isTrial: !!d.isTrial,
        trialCap: Number(d.trialCap ?? 0),
        hasPaymentToken: !!d.hasPaymentToken,
        planName: str(d.planName),
      };
    } catch {
      return null;
    }
  },

  /** Sends ONE test email to `to` (same endpoint/body as the web "send test email"). User-initiated only. */
  async sendTest(
    organization: string,
    user: EmailUserInfo,
    params: {
      to: string;
      provider: string;
      contentSource: EmailContentSource;
      templateId?: string;
      subject?: string;
      body?: string;
    },
  ): Promise<void> {
    const inlineLike = params.contentSource !== 'template';
    const body = inlineLike
      ? {
          organization,
          to: params.to,
          provider: params.provider,
          userId: user.userId,
          contentSource: 'inline',
          subject: params.subject || '',
          body: params.body || '',
          attachments: [],
        }
      : {
          organization,
          to: params.to,
          templateId: params.templateId,
          provider: params.provider,
          userId: user.userId,
        };
    const res = await axiosInstance.post(`${W}/SendTestEmail`, body);
    unwrapOk(res.data, 'Failed to send test email');
  },

  /**
   * RUNS the campaign (real send). Only call after the explicit preview confirmation.
   * Recipients are exactly what the preview listed (same contract as the web).
   */
  async run(
    organization: string,
    user: EmailUserInfo,
    campaignId: string,
    recipients: EmailPreviewRecipient[],
  ): Promise<EmailRunResult> {
    const res = await axiosInstance.post(`${W}/email-campaigns/${encodeURIComponent(campaignId)}/run`, {
      organizationName: organization,
      recipients: recipients.map((r) => ({ Id: r.id, Name: r.name, Email: r.email })),
      userId: user.userId || 'system',
      userName: user.userName || 'Gambot',
    });
    const d = res.data || {};
    return {
      ok: !!d.ok,
      resuming: !!d.resuming,
      blocked: !!(d.blocked || d.trialLimit),
      message: str(d.message),
      recipientCount: Number(d.recipientCount || recipients.length),
      error: str(d.error),
    };
  },

  async getResults(organization: string, campaignId: string): Promise<EmailCampaignResults> {
    const res = await axiosInstance.get(`${W}/email-campaigns/${encodeURIComponent(campaignId)}/results`, {
      params: { organizationName: organization },
    });
    const d = unwrapOk(res.data, 'Failed to load results');
    const c = d?.campaign || {};
    return {
      campaign: {
        id: str(c.id || campaignId),
        name: str(c.name),
        status: str(c.status),
        templateName: str(c.templateName),
        sentDate: str(c.sentDate),
      },
      recipients: asArray(d?.recipients).map((r: any) => ({
        email: str(r.email),
        name: str(r.name),
        status: str(r.status || 'sent').toLowerCase(),
        errorMessage: str(r.errorMessage),
        sentAt: str(r.sentAt),
        openedAt: str(r.openedAt),
        campaignRunId: str(r.campaignRunId),
      })),
    };
  },

  async getClickStats(organization: string, campaignId: string): Promise<EmailClickStats | null> {
    try {
      const res = await axiosInstance.post(`${W}/GetEmailCampaignClickStats`, { organization, campaignId });
      if (!res.data?.ok) return null;
      return { totalClicks: Number(res.data.totalClicks || 0) };
    } catch {
      return null;
    }
  },
};

export function errorMessage(e: any, fallback = 'Error'): string {
  return e?.response?.data?.error || e?.response?.data?.message || e?.message || fallback;
}
