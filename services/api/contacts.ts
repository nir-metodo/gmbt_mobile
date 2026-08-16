import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Contact } from '../../types';

export const contactsApi = {
  async getAll(
    organization: string,
    options?: { userId?: string; dataVisibility?: string; pageSize?: number; pageNumber?: number; modifiedSince?: string },
  ): Promise<Contact[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONTACTS_PAGINATED, {
      organizationiD: organization,
      pageNumber: options?.pageNumber || 1,
      pageSize: options?.pageSize || 100,
      userId: options?.userId || '',
      dataVisibility: options?.dataVisibility || 'all',
      // Incremental-sync cursor. Ignored by the backend until it supports delta pulls, at which
      // point only contacts modified since this timestamp are returned.
      ...(options?.modifiedSince ? { modifiedSince: options.modifiedSince } : {}),
    });
    const raw = response.data;
    const items = raw?.Contacts || raw?.Data || raw?.data || (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  // Contact fetch used by the Forward picker: supports a search term plus the same server-side
  // owner-name / tag filters the web sidebar views apply, so forwarding mirrors the chat views.
  async searchForForward(
    organization: string,
    options: {
      search?: string;
      ownerNames?: string[];
      tags?: string[];
      userId?: string;
      dataVisibility?: string;
      pageSize?: number;
    },
  ): Promise<Contact[]> {
    const payload: any = {
      organizationiD: organization,
      pageNumber: 1,
      pageSize: options.pageSize || 200,
      userId: options.userId || '',
      dataVisibility: options.dataVisibility || 'all',
    };
    // Phone-like search → last 9 digits (matches both local 05x… and intl 9725…); else raw text.
    const raw = (options.search || '').trim();
    if (raw) {
      const digits = raw.replace(/\D/g, '');
      const isPhone = /^[+\d][\d\s\-().]*$/.test(raw) && digits.length >= 3;
      payload.searchTerm = isPhone ? (digits.length >= 9 ? digits.slice(-9) : digits) : raw;
    }
    if (options.ownerNames?.length) payload.filterOwnerNames = options.ownerNames;
    if (options.tags?.length) {
      payload.filterTags = options.tags;
      payload.filterTagsOperator = 'contains_any';
    }
    const response = await axiosInstance.post(ENDPOINTS.GET_CONTACTS_PAGINATED, payload);
    const data = response.data;
    const items = data?.Contacts || data?.Data || data?.data || (Array.isArray(data) ? data : []);
    return Array.isArray(items) ? items : [];
  },

  async getById(organization: string, contactId: string): Promise<Contact | null> {
    // Prefer the full record (incl. dynamic/custom fields) like the web ContactFormView does.
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_CONTACT_BY_ID, {
        organization,
        contactId,
      });
      const data = response.data;
      const contact = data?.Contact || data?.contact || data?.Data || data?.data || data;
      if (contact && (contact.id || contact.phoneNumber)) {
        return contact as Contact;
      }
    } catch {
      // fall through to search-based lookup below
    }
    // Fallback: search (sparse record, but better than nothing).
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
    // The creator becomes the contact owner by default (mirrors the web + backend behavior), so the
    // person who adds a contact immediately sees themselves as the owner in Contacts and in chats.
    const ownerId = (contact as any).ownerId || userId || '';
    const ownerName = (contact as any).ownerName || userName || '';
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
        ownerId,
        ownerName,
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
    // Mirror the web: soft-delete via DeleteContactById with `contactID` (capital D).
    // The old DeleteContact/contactId call did not actually delete server-side, so the
    // contact reappeared after the list refreshed.
    const response = await axiosInstance.post(ENDPOINTS.DELETE_CONTACT_BY_ID, {
      contactID: contactId,
      organization,
    });
    return response.data;
  },

  async updateOwner(organization: string, contactId: string, owner: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONTACT_OWNER, {
      organization,
      contactPhoneNumber: contactId,
      ownerId: owner,
      user: { userName: userName || 'system' },
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
    attachment?: { uri: string; name: string; type: string },
  ): Promise<any> {
    const formData = new FormData();
    formData.append('organization', organization);
    formData.append('contactId', contactId);
    formData.append('note', note);
    formData.append('userId', userId);
    formData.append('userName', userName);
    if (attachment) {
      formData.append('file', { uri: attachment.uri, name: attachment.name, type: attachment.type } as any);
    }
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
