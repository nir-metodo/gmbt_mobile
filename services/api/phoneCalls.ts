import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { PhoneCall, CallRule } from '../../types';

export interface GetAppCallsOptions {
  userId?: string;
  [key: string]: any;
}

export const phoneCallsApi = {
  async getAppCalls(
    organization: string,
    options?: GetAppCallsOptions
  ): Promise<PhoneCall[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_APP_PHONE_CALLS, {
      organization,
      pageSize: options?.pageSize ?? 100,
      userId: options?.userId,
      ...options,
    });
    const raw = response.data;
    const items = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return (Array.isArray(items) ? items : []).map((c: any) => ({
      ...c,
      id: c.id ?? c.callId ?? c.CallId,
      phoneNumber: c.phoneNumber ?? c.to ?? c.PhoneNumber ?? '',
      contactName: c.contactName ?? c.customerName ?? c.ContactName ?? '',
    }));
  },

  async createAppCall(
    organization: string,
    callData: Partial<PhoneCall>
  ): Promise<{ callId?: string; id?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.CREATE_APP_PHONE_CALL, {
      organization,
      ...callData,
    });
    return response.data || {};
  },

  async updateAppCall(
    organization: string,
    callId: string,
    updates: { duration?: string; status?: string; transcription?: string }
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_APP_PHONE_CALL, {
      organization,
      callId,
      ...updates,
    });
    return response.data;
  },

  async getCallRecording(
    organization: string,
    callId: string
  ): Promise<{ url?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALL_RECORDING, {
      organization,
      callId,
    });
    return response.data || {};
  },

  async logCall(organization: string, callData: Partial<PhoneCall>): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.LOG_CALL, {
      organization,
      ...callData,
    });
    return response.data;
  },

  async getCallLogs(
    organization: string,
    filters?: Record<string, any>
  ): Promise<PhoneCall[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALL_LOGS, {
      organization,
      ...filters,
    });
    const raw = response.data;
    const items = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async uploadRecording(
    organization: string,
    callId: string,
    recordingUri: string
  ): Promise<any> {
    const formData = new FormData();
    formData.append('organization', organization);
    formData.append('callId', callId);
    formData.append('recording', {
      uri: recordingUri,
      type: 'audio/m4a',
      name: `recording_${callId}.m4a`,
    } as any);

    const response = await axiosInstance.post(ENDPOINTS.UPLOAD_RECORDING, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async transcribeCall(organization: string, callId: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.TRANSCRIBE_CALL, {
      organization,
      callId,
    });
    return response.data;
  },

  async getTelephonySettings(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_TELEPHONY_SETTINGS, { organization });
    return response.data?.Data || response.data?.data || response.data || {};
  },

  async gambotOutboundCall(payload: {
    organizationName: string;
    phoneNumber: string;
    fromPhoneNumber: string;
    agentPhone: string;
    agentIdentity: string;
    agentId: string;
    agentName: string;
    customerName?: string;
    notes?: string;
  }): Promise<{ success: boolean; callId?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.TELNYX_OUTBOUND_CALL, payload);
    return response.data || {};
  },

  async getCallRules(organization: string): Promise<CallRule[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALL_RULES, {
      organization,
    });
    return response.data || [];
  },

  async updateCallRules(organization: string, rules: CallRule[]): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_CALL_RULES, {
      organization,
      rules,
    });
    return response.data;
  },
};
