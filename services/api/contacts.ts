import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Contact } from '../../types';

export const contactsApi = {
  async getAll(
    organization: string,
    options?: { userId?: string; dataVisibility?: string },
  ): Promise<Contact[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONTACTS_PAGINATED, {
      organizationiD: organization,
      pageNumber: 1,
      pageSize: 9999,
      userId: options?.userId || '',
      dataVisibility: options?.dataVisibility || 'all',
    });
    const raw = response.data;
    const items = raw?.Contacts || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, contactId: string): Promise<Contact | null> {
    try {
      const results = await this.search(organization, contactId, 5);
      return results.find((c) => c.id === contactId || c.phoneNumber === contactId) ?? results[0] ?? null;
    } catch {
      return null;
    }
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

  async create(
    organization: string,
    contact: Partial<Contact>,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const now = new Date().toISOString();
    const cleanedNumber = (contact.phoneNumber || contact.id || '').replace(/\D/g, '');
    const response = await axiosInstance.post(ENDPOINTS.CREATE_CONTACT, {
      organization,
      contactData: {
        organization,
        email: contact.email || '',
        name: contact.name || '',
        photoURL: '',
        lastMessage: 'New Contact Created',
        createdOn: now,
        modifiedOn: now,
        from: contact.from || '',
        to: cleanedNumber,
        phoneNumber: cleanedNumber,
        id: cleanedNumber,
        keys: contact.keys || '',
        ...contact,
      },
      user: {
        userId: userId || '',
        userName: userName || 'Gambot',
      },
    });
    return response.data;
  },

  async update(
    organization: string,
    contact: Partial<Contact>,
    userId?: string,
    userName?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT_BY_ID, {
      organization,
      contactData: {
        organization,
        ...contact,
      },
      user: {
        userId: userId || '',
        userName: userName || 'Gambot',
      },
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
    const { sections } = await this.getDynamicContactColumns(organization);
    if (sections.length === 0) return [];
    const flat: any[] = [];
    sections.forEach((s: any) => {
      const fields = s.fields || {};
      Object.entries(fields).forEach(([key, f]: [string, any]) => {
        const field = typeof f === 'object' && f !== null ? f : {};
        flat.push({
          fieldName: key,
          displayName: field.labelEn || field.labelHe || field.label || key,
          fieldType: field.type || 'text',
          options: field.options || [],
          showOnForm: field.showOnForm !== false,
          order: field.order ?? 999,
          isMultiple: field.type === 'multi-select',
        });
      });
    });
    return flat.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  },

  async getDynamicContactColumns(organization: string): Promise<{ sections: any[]; formLayout: string[] }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_DYNAMIC_COLUMNS, {
      organization,
    });
    const raw = response.data;
    if (raw?.error) return { sections: [], formLayout: [] };
    if (Array.isArray(raw?.sections) && raw.sections.length > 0) {
      return {
        sections: raw.sections,
        formLayout: Array.isArray(raw.formLayout) ? raw.formLayout : [],
      };
    }
    const keys = Object.keys(raw || {}).filter(
      (k) => k !== 'sections' && k !== 'formLayout' && typeof raw[k] === 'object' && raw[k] !== null,
    );
    if (keys.length === 0) return { sections: [], formLayout: [] };
    const fields: Record<string, any> = {};
    keys.forEach((k) => {
      fields[k] = raw[k];
    });
    return {
      sections: [{ id: 'default', labelEn: 'Details', labelHe: 'פרטים', fields }],
      formLayout: [],
    };
  },
};
