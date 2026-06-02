import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  isHtml: boolean;
  category: string;
}

export const emailApi = {
  async send(params: {
    organizationName: string;
    connectionId: string;
    toEmails: string[];
    subject: string;
    message: string;
    attachments?: { name: string; contentType: string; content: string }[];
    contactId?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }): Promise<{ ok: boolean }> {
    const response = await axiosInstance.post(ENDPOINTS.SEND_EMAIL, params);
    return response.data;
  },

  async getTemplates(organizationName: string): Promise<EmailTemplate[]> {
    const response = await axiosInstance.get(ENDPOINTS.GET_EMAIL_TEMPLATES, {
      params: { organizationName },
    });
    const data = response.data;
    const templates = data?.templates || data?.Templates || (Array.isArray(data) ? data : []);
    return templates.map((t: any) => ({
      id: t.Id || t.id || '',
      name: t.Name || t.name || '',
      subject: t.Subject || t.subject || '',
      body: t.Body || t.body || t.HtmlContent || t.htmlContent || '',
      isHtml: t.IsHtml ?? t.isHtml ?? true,
      category: t.Category || t.category || 'general',
    }));
  },
};
