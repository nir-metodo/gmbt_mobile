import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Case } from '../../types';

export interface CaseFilters {
  searchTerm?: string;
  statuses?: string[];
  owners?: string[];
  priorities?: string[];
  categories?: string[];
  sources?: string[];
  dateFrom?: string;
  dateTo?: string;
  dateRangePreset?: string;
}

export const casesApi = {
  async getAll(
    organization: string,
    options?: {
      userId?: string;
      dataVisibility?: string;
      page?: number;
      pageSize?: number;
      filters?: CaseFilters;
    },
  ): Promise<{ data: Case[]; total: number }> {
    const { userId, dataVisibility, page = 1, pageSize = 30, filters = {} } = options || {};
    const response = await axiosInstance.post(ENDPOINTS.GET_CASES, {
      organization,
      pageNumber: page,
      pageSize,
      searchTerm: filters.searchTerm || '',
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
      statuses: filters.statuses || [],
      owners: filters.owners || [],
      priorities: filters.priorities || [],
      categories: filters.categories || [],
      sources: filters.sources || [],
      dateFrom: filters.dateFrom || '',
      dateTo: filters.dateTo || '',
      dateRangePreset: filters.dateRangePreset || '',
    });
    const raw = response.data;
    const items = raw?.Cases || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    const total = raw?.TotalCount ?? raw?.totalCount ?? 0;
    return {
      data: Array.isArray(items) ? items : [],
      total: typeof total === 'number' ? total : 0,
    };
  },

  async getById(organization: string, caseId: string): Promise<Case> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CASE_BY_ID || '/api/Webhooks/GetCaseById', {
      organization,
      caseId,
    });
    return response.data;
  },

  async getSettings(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CASE_SETTINGS, {
      organization,
    });
    return response.data;
  },

  async create(organization: string, caseData: Partial<Case>, userName?: string, userId?: string): Promise<any> {
    const { title, assignedTo, assignedToName, ...rest } = caseData as any;
    const response = await axiosInstance.post(ENDPOINTS.CREATE_CASE, {
      organization,
      caseData: {
        ...rest,
        organization,
        title,
        subject: title,
        assignedTo,
        assignedToId: assignedTo,
        ownerId: assignedTo,
        assignedToName,
        ownerName: assignedToName,
        createdBy: userId || '',
        createdByName: userName || '',
      },
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async update(organization: string, caseId: string, caseData: Partial<Case>, userName?: string, userId?: string): Promise<any> {
    const { title, assignedTo, assignedToName, ...rest } = caseData as any;
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CASE, {
      organization,
      caseId,
      caseData: {
        ...rest,
        title,
        subject: title,
        assignedTo,
        assignedToId: assignedTo,
        ownerId: assignedTo,
        assignedToName,
        ownerName: assignedToName,
      },
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async delete(organization: string, caseId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_CASE, {
      organization,
      caseId,
    });
    return response.data;
  },
};
