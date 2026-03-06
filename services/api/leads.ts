import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Lead, LeadStage } from '../../types';

export const leadsApi = {
  async getAll(
    organization: string,
    userId?: string,
    dataVisibility?: string,
    page?: number,
    pageSize?: number,
    searchTerm?: string,
  ): Promise<{ data: Lead[]; total: number }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_LEADS, {
      organization,
      pageNumber: page || 1,
      pageSize: pageSize || 5000,
      searchTerm: searchTerm || '',
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
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

  async getPipelineSettings(organization: string): Promise<{ stages: LeadStage[] }> {
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
    };
  },

  async getLeadFormSettings(organization: string): Promise<{ sections: any[]; formLayout: string[] }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_LEAD_FORM_SETTINGS, {
      organization,
    });
    const raw = response.data;
    if (raw?.error) return { sections: [], formLayout: [] };
    return {
      sections: Array.isArray(raw?.sections) ? raw.sections : [],
      formLayout: Array.isArray(raw?.formLayout) ? raw.formLayout : [],
    };
  },
};
