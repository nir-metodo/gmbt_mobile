import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { Message, Template, QuickMessage } from '../../types';

export const chatsApi = {
  async getMessages(
    organization: string,
    phoneNumber: string,
    limit?: number,
  ): Promise<Message[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_MESSAGES, {
      organizationiD: organization,
      phoneNumber,
      ...(limit ? { limit } : {}),
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

  async getInternalMessagesHub(params: {
    organization: string;
    scope: 'org' | 'user' | 'contact';
    targetUserId?: string | null;
    contactId?: string | null;
    searchTerm?: string | null;
    currentUserId: string;
    canViewAll?: boolean;
    limit?: number;
  }): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_INTERNAL_MESSAGES_HUB, {
      organizationName: params.organization,
      scope: params.scope,
      targetUserId: params.scope === 'user' ? (params.targetUserId || params.currentUserId) : null,
      contactId: params.scope === 'contact' ? (params.contactId || '').trim() : null,
      searchTerm: params.searchTerm?.trim() || null,
      currentUserId: params.currentUserId,
      canViewAll: !!params.canViewAll,
      limit: params.limit ?? 150,
    });
    const list = response.data?.messages || [];
    return Array.isArray(list) ? list : [];
  },

  async createInternalMessage(params: {
    organization: string;
    messageText: string;
    mentionedUsers: { userId: string; userName: string }[];
    relatedContactPhone?: string;
    generalLabel: string;
    sentById: string;
    sentByName: string;
  }): Promise<any> {
    const isContact = !!params.relatedContactPhone?.trim();
    const response = await axiosInstance.post(ENDPOINTS.CREATE_INTERNAL_MESSAGE, {
      organizationName: params.organization,
      messageText: params.messageText.trim(),
      mentionedUsers: params.mentionedUsers || [],
      relatedEntityType: isContact ? 'contact' : 'general',
      relatedEntityId: isContact ? params.relatedContactPhone!.trim() : '',
      relatedEntityName: isContact ? params.relatedContactPhone!.trim() : params.generalLabel,
      sentById: params.sentById,
      sentByName: params.sentByName,
      createdFrom: 'internalHub',
    });
    return response.data;
  },

  async markMentionAsRead(organization: string, messageId: string, userId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.MARK_MENTION_READ, {
      organizationName: organization,
      messageId,
      userId,
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

  async markAsUnread(organization: string, phoneNumber: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.MARK_AS_UNREAD, {
      organization,
      phoneNumber,
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
    scheduledTime: string,
    opts: {
      messageType?: 'text' | 'template';
      text?: string;
      templateConfig?: any;
      timezone?: string;
      fromNumberId?: string;
    } = {},
  ): Promise<any> {
    // Backend (ScheduleMessage) reads: organization, to, sendAt, timezone, messageType,
    // text, templateConfig, fromNumberId. (The old payload used wrong field names, so
    // scheduling silently failed with "Missing required fields".)
    const response = await axiosInstance.post(ENDPOINTS.SCHEDULE_MESSAGE, {
      organization,
      to,
      sendAt: scheduledTime,
      timezone: opts.timezone || 'Asia/Jerusalem',
      messageType: opts.messageType || 'text',
      text: opts.text || '',
      ...(opts.templateConfig ? { templateConfig: opts.templateConfig } : {}),
      fromNumberId: opts.fromNumberId || undefined,
    });
    const data = response.data;
    // Backend returns { success: false, error } on validation failures without HTTP error.
    if (data && (data.success === false || data.Success === false)) {
      throw new Error(data.error || data.Error || data.Message || 'Failed to schedule message');
    }
    return data;
  },

  // Cancel a scheduled message (matches web's /api/Webhooks/CancelScheduledMessage).
  async cancelScheduledMessage(organization: string, scheduledMessageId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.CANCEL_SCHEDULED_MESSAGE, {
      organization,
      scheduledMessageId,
    });
    const data = response.data;
    if (data && (data.success === false || data.Success === false)) {
      throw new Error(data.error || data.Error || data.Message || 'Failed to cancel scheduled message');
    }
    return data;
  },

  // List scheduled messages for a contact.
  async getScheduledMessages(organization: string, to: string): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_SCHEDULED_MESSAGES, {
      organization,
      to,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
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

  async getConversationCategories(organization: string): Promise<string[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONVERSATION_CATEGORIES, {
      organization,
    });
    const raw = response.data;
    return Array.isArray(raw) ? raw : raw?.Data || raw?.data || [];
  },

  async updateConversationCategory(
    organization: string,
    phoneNumber: string,
    category: string,
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CONVERSATION_CATEGORY, {
      organization,
      phoneNumber,
      category,
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

  async getTemplateById(organization: string, templateId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TEMPLATE_BY_ID, {
      organizationId: organization,
      templateId,
    });
    if (response.data && !response.data.error) {
      return response.data;
    }
    return null;
  },

  async getMediaByTemplateId(organization: string, templateId: string): Promise<string> {
    try {
      const response = await axiosInstance.post(ENDPOINTS.GET_MEDIA_BY_TEMPLATE_ID, {
        organization,
        templateId,
      });
      return response.data?.mediaUrl || '';
    } catch {
      return '';
    }
  },

  async getQuickMessages(organization: string): Promise<QuickMessage[]> {
    // Backend (GetQuickMessages) reads `organizationName`, not `organization`.
    const response = await axiosInstance.post(ENDPOINTS.GET_QUICK_MESSAGES, {
      organizationName: organization,
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

  async getConversationExpiration(organization: string, phoneNumber: string): Promise<string | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CONVERSATION_EXPIRATION, {
      organization,
      phoneNumber,
    });
    const data = response.data;
    if (data && typeof data === 'string' && data.trim()) return data.trim();
    return null;
  },

  async getDefaultMessageTemplates(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_DEFAULT_MESSAGE_TEMPLATES, {
      organization,
    });
    return response.data;
  },
};
