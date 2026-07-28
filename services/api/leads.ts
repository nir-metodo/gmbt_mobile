import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Lead, LeadStage } from '../../types';

export interface LeadFieldConfig {
  showCompany: boolean;
  showJobTitle: boolean;
  showCurrency: boolean;
  defaultCurrency: string;
}

export interface LeadFilters {
  searchTerm?: string;
  stages?: string[];
  statuses?: string[];
  owners?: string[];
  priorities?: string[];
  sources?: string[];
  dateFrom?: string;
  dateTo?: string;
  dateRangePreset?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  campaignId?: string;
  formId?: string;
  adId?: string;
}

/** Distinct values that exist in the org's leads, keyed by field name. */
export type LeadFilterOptions = Record<string, string[]>;

export const leadsApi = {
  async getAll(
    organization: string,
    options?: {
      userId?: string;
      dataVisibility?: string;
      page?: number;
      pageSize?: number;
      filters?: LeadFilters;
    },
  ): Promise<{ data: Lead[]; total: number }> {
    const { userId, dataVisibility, page = 1, pageSize = 30, filters = {} } = options || {};
    const response = await axiosInstance.post(ENDPOINTS.GET_LEADS, {
      organization,
      pageNumber: page,
      pageSize,
      searchTerm: filters.searchTerm || '',
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
      stages: filters.stages || [],
      statuses: filters.statuses || [],
      owners: filters.owners || [],
      priorities: filters.priorities || [],
      sources: filters.sources || [],
      dateFrom: filters.dateFrom || '',
      dateTo: filters.dateTo || '',
      dateRangePreset: filters.dateRangePreset || '',
      utmSource: filters.utmSource || '',
      utmMedium: filters.utmMedium || '',
      utmCampaign: filters.utmCampaign || '',
      campaignId: filters.campaignId || '',
      formId: filters.formId || '',
      adId: filters.adId || '',
    });
    const raw = response.data;
    const items = raw?.Leads || raw?.Data || raw?.data || raw?.leads || (Array.isArray(raw) ? raw : []);
    if (raw?.error) throw new Error(raw.error);
    const parsed = Array.isArray(items) ? items : [];
    const withIds = parsed.map((item: any, idx: number) => ({
      ...item,
      id: item.id || item.Id || item.leadId || item.LeadId || `lead_${idx}`,
    }));
    return {
      data: withIds,
      total: raw?.TotalCount || raw?.totalCount || parsed.length,
    };
  },

  async getFilterOptions(organization: string): Promise<LeadFilterOptions> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_LEAD_FILTER_OPTIONS, { organization });
      const raw = response.data;
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  },

  async getByContact(organization: string, contactId: string): Promise<Lead[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_LEADS_BY_CONTACT, {
      organization,
      contactId,
    });
    const raw = response.data;
    const items = raw?.Leads || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async create(organization: string, lead: Partial<Lead>, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_LEAD, {
      organization,
      leadData: lead,
      userId,
      userName,
      // The backend attributes timeline entries from json["user"]["userName"] (mirrors web + cases).
      // Without this the lead's timeline documented every change as "system" instead of the real user.
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async update(organization: string, lead: Partial<Lead>, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_LEAD, {
      organization,
      leadId: lead.id,
      leadData: lead,
      userId,
      userName,
      // The backend attributes timeline entries from json["user"]["userName"] (mirrors web + cases).
      // Without this the lead's timeline documented every change as "system" instead of the real user.
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async moveStage(organization: string, leadId: string, stageId: string, stageName: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.MOVE_LEAD_STAGE, {
      organization,
      leadId,
      stageId,
      stageName,
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async delete(organization: string, leadId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_LEAD, {
      organization,
      leadId,
    });
    return response.data;
  },

  async getPipelineSettings(organization: string): Promise<{ stages: LeadStage[]; enableProductCatalog?: boolean; syncCatalogToValue?: boolean }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_PIPELINE_SETTINGS, {
      organization,
    });
    const raw = response.data;
    const stages: LeadStage[] =
      raw?.pipelines?.[0]?.stages ||
      raw?.stages ||
      (Array.isArray(raw) ? raw : []);
    return {
      stages: stages.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      enableProductCatalog: !!raw?.enableProductCatalog,
      syncCatalogToValue: !!raw?.syncCatalogToValue,
    };
  },

  async getCatalogItems(organization: string): Promise<any[]> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, { organization });
      const raw = response.data;
      return Array.isArray(raw?.catalogItems) ? raw.catalogItems : [];
    } catch {
      return [];
    }
  },

  async getLeadFormSettings(organization: string): Promise<{ sections: any[]; formLayout: string[]; fieldConfig: LeadFieldConfig }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_LEAD_FORM_SETTINGS, { organization });
    const raw = response.data;
    const defaultFieldConfig: LeadFieldConfig = { showCompany: true, showJobTitle: true, showCurrency: true, defaultCurrency: 'ILS' };
    if (raw?.error) return { sections: [], formLayout: [], fieldConfig: defaultFieldConfig };
    let sections = raw?.sections;
    if (sections && !Array.isArray(sections)) sections = Object.values(sections);
    let formLayout = raw?.formLayout;
    if (formLayout && !Array.isArray(formLayout)) formLayout = Object.values(formLayout);
    const cfg = (raw?.fieldConfig && typeof raw.fieldConfig === 'object') ? raw.fieldConfig : {};
    return {
      sections: Array.isArray(sections) ? sections : [],
      formLayout: Array.isArray(formLayout) ? formLayout : [],
      fieldConfig: {
        showCompany: cfg.showCompany !== false,
        showJobTitle: cfg.showJobTitle !== false,
        showCurrency: cfg.showCurrency !== false,
        defaultCurrency: cfg.defaultCurrency || 'ILS',
      },
    };
  },

  async getViews(organization: string): Promise<LeadView[]> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_LEAD_VIEWS, { organization });
      return Array.isArray(response.data) ? response.data : [];
    } catch { return []; }
  },

  async saveView(organization: string, viewData: LeadView): Promise<LeadView | null> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.SAVE_LEAD_VIEW, { organization, viewData });
      return response.data;
    } catch { return null; }
  },

  async deleteView(organization: string, viewId: string): Promise<void> {
    try {
      await axiosInstance.post(ENDPOINTS.DELETE_LEAD_VIEW, { organization, viewId });
    } catch {}
  },
};

export interface LeadView {
  id: string;
  name: string;
  filters: Record<string, any>;
  builtIn?: boolean;
}
