import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Contact } from '../../types';

export const contactsApi = {
  async getAll(organization: string): Promise<Contact[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONTACTS, {
      organizationiD: organization,
    });
    const raw = response.data;
    const items = raw?.Contacts || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async search(organization: string, searchTerm: string, limit = 30): Promise<Contact[]> {
    const response = await axiosInstance.post(ENDPOINTS.SEARCH_CONTACTS, {
      organization,
      searchTerm,
      limit,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : (raw?.Contacts || raw?.Data || raw?.data || []);
  },

  async update(organization: string, contact: Partial<Contact>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT, {
      organization,
      ...contact,
    });
    return response.data;
  },

  async delete(organization: string, contactId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_CONTACT, {
      organization,
      contactId,
    });
    return response.data;
  },

  async updateOwner(organization: string, contactId: string, owner: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT_OWNER, {
      organization,
      contactId,
      owner,
    });
    return response.data;
  },

  async getTimeline(organization: string, phoneNumber: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TIMELINE, {
      organization,
      phoneNumber,
    });
    return response.data || [];
  },

  async getRelatedRecords(organization: string, contactId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_RELATED_RECORDS, {
      organization,
      contactId,
    });
    return response.data;
  },

  async getLeadsByContact(organization: string, contactPhone: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_LEADS_BY_CONTACT, {
      organization,
      contactPhone,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.leads || raw?.data || [];
  },

  async addTimelineEntry(
    organization: string,
    contactId: string,
    note: string,
    userId: string,
    userName: string,
  ): Promise<any> {
    const formData = new FormData();
    formData.append('organization', organization);
    formData.append('contactId', contactId);
    formData.append('note', note);
    formData.append('userId', userId);
    formData.append('userName', userName);
    const response = await axiosInstance.post(ENDPOINTS.ADD_TIMELINE_ENTRY, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteTimelineEntry(
    organization: string,
    timelineId: string,
    contactId: string,
    userId: string,
    userName: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.DELETE_TIMELINE_ENTRY, {
      organization,
      timelineId,
      contactId,
      userId,
      userName,
    });
    return response.data;
  },

  async getDynamicColumns(organization: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_DYNAMIC_COLUMNS, {
      organization,
    });
    const raw = response.data;
    if (Array.isArray(raw)) return raw;
    if (raw?.columns && Array.isArray(raw.columns)) return raw.columns;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    if (typeof raw === 'object' && raw !== null) {
      return Object.entries(raw).map(([key, val]: [string, any]) => ({
        fieldName: key,
        displayName: val?.label || key,
        fieldType: val?.type || 'text',
        options: val?.options || [],
        showOnForm: val?.showOnForm !== false,
        order: val?.order ?? 999,
        isMultiple: val?.multiple || false,
      }));
    }
    return [];
  },
};
