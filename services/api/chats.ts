import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Message, Template, QuickMessage } from '../../types';

export const chatsApi = {
  async getMessages(
    organization: string,
    phoneNumber: string,
  ): Promise<Message[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_MESSAGES, {
      organizationiD: organization,
      phoneNumber,
    });
    const raw = response.data;
    const items = Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
    return Array.isArray(items) ? items : [];
  },

  async sendMessage(
    organization: string,
    to: string,
    message: string,
    senderName?: string,
    userId?: string,
    contextMessageId?: string,
    wabaNumber?: string,
    senderEmail?: string,
  ): Promise<any> {
    const payload = {
      text: message,
      from: wabaNumber || '',
      to,
      senderEmail: senderEmail || '',
      receiverEmail: to,
      timeStamp: '',
      sentByName: senderName || '',
      sentById: userId || '',
      organization,
      ...(contextMessageId ? { contextMessageId } : {}),
    };

    if (!payload.from) {
      console.warn('[chatsApi.sendMessage] "from" field is empty — backend may reject the message.');
    }
    console.log('[chatsApi.sendMessage] POST', ENDPOINTS.CREATE_OUTBOUND_MESSAGE, { to: payload.to, from: payload.from, org: payload.organization });

    try {
      const response = await axiosInstance.post(ENDPOINTS.CREATE_OUTBOUND_MESSAGE, payload);
      const data = response.data;
      if (data && data.Success === false) {
        console.error('[chatsApi.sendMessage] Backend failure:', data.Message);
        throw new Error(data.Message || 'Failed to send message');
      }
      return data;
    } catch (err: any) {
      console.error('[chatsApi.sendMessage] Error:', err?.response?.status, err?.response?.data || err?.message);
      throw err;
    }
  },

  async sendMediaMessage(
    organization: string,
    to: string,
    file: { uri: string; name: string; type: string; size?: number },
    caption?: string,
    userId?: string,
    fromNumberId?: string,
  ): Promise<any> {
    const formData = new FormData();
    formData.append('phoneNumber', to);
    formData.append('Org', organization);
    formData.append('userId', userId || '');
    formData.append('source', 'chat');
    formData.append('caption', caption || '');
    formData.append('fileName', file.name);
    formData.append('file_type', file.type);
    formData.append('file_length', String(file.size || 0));
    if (fromNumberId) formData.append('fromNumberId', fromNumberId);
    formData.append('File', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);
    const response = await axiosInstance.post(ENDPOINTS.CREATE_MEDIA_MESSAGE, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const data = response.data;
    if (data && data.Success === false) {
      throw new Error(data.Message || 'Failed to send media message');
    }
    return data;
  },

  async sendInternalMessage(
    organization: string,
    phoneNumber: string,
    message: string,
    senderName: string,
    sentById?: string,
    mentionedUsers?: { userId: string; userName: string }[],
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_INTERNAL_MESSAGE, {
      organizationName: organization,
      messageText: message,
      mentionedUsers: mentionedUsers || [],
      relatedEntityType: 'contact',
      relatedEntityId: phoneNumber,
      relatedEntityName: phoneNumber,
      sentById: sentById || '',
      sentByName: senderName,
      createdFrom: 'chat',
    });
    return response.data;
  },

  async markAsRead(organization: string, phoneNumber: string, userId?: string, userName?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.MARK_AS_READ, {
      organization,
      phoneNumber,
      user: { userId: userId || '', fullname: userName || '' },
    });
    return response.data;
  },

  async toggleStarred(
    organization: string,
    messageId: string,
    phoneNumber: string,
    isStarred: boolean,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.TOGGLE_STARRED, {
      organization,
      messageId,
      phoneNumber,
      isStarred,
    });
    return response.data;
  },

  async searchMessages(organization: string, query: string): Promise<Message[]> {
    const response = await axiosInstance.post(ENDPOINTS.SEARCH_MESSAGES, {
      organizationiD: organization,
      query,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
  },

  async getStarredMessages(organization: string): Promise<Message[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_STARRED_MESSAGES, {
      organizationiD: organization,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
  },

  async scheduleMessage(
    organization: string,
    to: string,
    message: string,
    scheduledTime: string,
    fromNumberId?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SCHEDULE_MESSAGE, {
      organizationiD: organization,
      to,
      message,
      scheduledTime,
      fromNumberId: fromNumberId || undefined,
    });
    return response.data;
  },

  async getConversationStatus(organization: string, phoneNumber: string, fromNumberId?: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONVERSATION_STATUS, {
      organization,
      phoneNumber,
      ...(fromNumberId ? { fromNumberId } : {}),
    });
    return response.data;
  },

  async updateConversationStatus(
    organization: string,
    phoneNumber: string,
    status: string,
    modifiedById?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONVERSATION_STATUS, {
      organization,
      phoneNumber,
      status,
      modifiedById: modifiedById || '',
    });
    return response.data;
  },

  async getTemplates(organization: string): Promise<Template[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TEMPLATES, {
      organization,
      organizationiD: organization,
    });
    const raw = response.data;
    if (raw?.error) throw new Error(raw.error);
    const items = Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
    return (Array.isArray(items) ? items : []).filter(
      (t: any) => !t.error && (t.status === 'APPROVED' || String(t.status || '').toLowerCase() === 'approved'),
    );
  },

  async getQuickMessages(organization: string): Promise<QuickMessage[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_QUICK_MESSAGES, {
      organization,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
  },

  async sendTemplateMessage(
    organization: string,
    phoneNumber: string,
    templateId: string,
    sentById?: string,
    templateVariableQuery?: any[],
    fromNumberId?: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SEND_TEMPLATE_MESSAGE, {
      organization,
      fromNumberId: fromNumberId || undefined,
      templateMessageData: {
        PhoneNumber: phoneNumber,
        TemplateId: templateId,
        SentById: sentById || '',
        TemplateVariableQuery: templateVariableQuery || [],
        LocationDetails: {
          locationName: '',
          locationAddress: '',
          longitude: '',
          latitude: '',
        },
      },
    });
    const data = response.data;
    if (data && data.Success === false) {
      throw new Error(data.Message || 'Failed to send template message');
    }
    return data;
  },

  async sendReaction(
    organization: string,
    messageId: string,
    phoneNumber: string,
    emoji: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.SEND_REACTION, {
      organization,
      messageId,
      phoneNumber,
      emoji,
    });
    return response.data;
  },

  async getChatTimeline(organization: string, phoneNumber: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CHAT_TIMELINE, {
      organizationiD: organization,
      phoneNumber,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
  },
};
