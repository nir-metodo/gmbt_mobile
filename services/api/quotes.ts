import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Quote } from '../../types';

export const quotesApi = {
  async getAll(
    organization: string,
    userId?: string,
    dataVisibility?: string,
    page?: number,
    pageSize?: number,
    searchTerm?: string,
    statusFilter?: string,
    sortField?: string,
    sortDirection?: string,
  ): Promise<{ data: Quote[]; total: number }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTES_PAGINATED, {
      organization,
      pageNumber: page || 1,
      pageSize: pageSize || 100,
      searchTerm: searchTerm || '',
      statusFilter: statusFilter || 'all',
      userId: userId || '',
      dataVisibility: dataVisibility || 'seeAll',
      sortField: sortField || 'createdOn',
      sortDirection: sortDirection || 'desc',
    });
    const raw = response.data;
    const items = raw?.Quotes || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    const total = raw?.TotalCount ?? raw?.totalCount ?? 0;
    return {
      data: Array.isArray(items) ? items : [],
      total: typeof total === 'number' ? total : 0,
    };
  },

  async getById(organization: string, quoteId: string): Promise<Quote> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BY_ID, {
      organization,
      quoteId,
    });
    return response.data;
  },

  async getBranding(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUOTE_BRANDING, {
      organization,
    });
    return response.data;
  },

  async create(
    organization: string,
    quoteData: Partial<Quote>,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_QUOTE, {
      organization,
      quoteData,
      userId: userId || '',
      userName: userName || '',
    });
    return response.data;
  },

  async update(
    organization: string,
    quoteData: Partial<Quote> & { id: string },
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_QUOTE, {
      organization,
      quoteId: quoteData.id,
      quoteData,
      userId: userId || '',
      userName: userName || '',
    });
    return response.data;
  },

  async delete(organization: string, quoteId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_QUOTE, {
      organization,
      quoteId,
    });
    return response.data;
  },
};
