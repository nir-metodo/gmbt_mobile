import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Case } from '../../types';

export const casesApi = {
  async getAll(
    organization: string,
    userId?: string,
    dataVisibility?: string,
    page?: number,
    pageSize?: number,
    searchTerm?: string,
  ): Promise<{ data: Case[]; total: number }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CASES, {
      organization,
      pageNumber: page || 1,
      pageSize: pageSize || 100,
      searchTerm: searchTerm || '',
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
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

  async create(organization: string, caseData: Partial<Case>, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_CASE, {
      organization,
      caseData: {
        ...caseData,
        organization,
      },
      user: { userName: userName || '' },
    });
    return response.data;
  },

  async update(organization: string, caseId: string, caseData: Partial<Case>, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CASE, {
      organization,
      caseId,
      caseData,
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
