import axiosInstance from './axiosInstance';
import { ENDPOINTS } from '../../constants/api';
import type { PhoneCall, CallRule } from '../../types';

export interface GetAppCallsOptions {
  userId?: string;
  [key: string]: any;
}

/** Office-number call-log document -> the app's PhoneCall (status folded to answered / missed / busy / no_answer). */
export function mapPbxCall(c: any): PhoneCall {
  const direction: 'inbound' | 'outbound' = String(c.direction || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound';
  const raw = String(c.status || '').toLowerCase();
  const duration = parseInt(String(c.duration ?? '0'), 10) || 0;
  let status: PhoneCall['status'];
  if (raw === 'completed' && duration > 0) status = 'answered';
  else if (raw === 'busy') status = 'busy';
  else if (direction === 'inbound') status = 'missed';
  else status = 'no_answer';
  const name = String(c.customerName || '').trim();
  const id = String(c.callId ?? c.id ?? '');
  return {
    id,
    callId: id,
    source: 'pbx',
    phoneNumber: String((direction === 'inbound' ? c.from : c.to) ?? ''),
    contactName: /^(unknown|unkown|gambot)$/i.test(name) ? '' : name,
    direction,
    status,
    duration,
    startTime: c.createdOn,
    createdAt: c.createdOn,
    recordingUrl: c.recordingUrl || undefined,
    agentName: c.createdByName || c.agentName || undefined,
  };
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
      createdAt: c.createdAt ?? c.createdOn ?? c.startTime ?? '',
    }));
  },

  /**
   * The organization's real call log (office-number calls: inbound + outbound, incl. the ones placed through
   * the app's Gambot dialer) - the same source the web "Phone Calls" page uses. `userId` limits it to own calls.
   */
  async getPbxCalls(
    organization: string,
    options?: { userId?: string; pageSize?: number }
  ): Promise<PhoneCall[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_PHONE_CALLS, {
      organization,
      pageNumber: 1,
      pageSize: options?.pageSize ?? 100,
      dataVisibility: options?.userId ? 'own' : 'all',
      userId: options?.userId || '',
      search: '',
      direction: 'all',
      status: 'all',
      agentIds: [],
      dateFrom: '',
      dateTo: '',
    });
    const items = response.data?.Data ?? response.data?.data ?? [];
    return (Array.isArray(items) ? items : []).map(mapPbxCall);
  },

  /** All office-number calls of one contact (phone in any format) - the "Calls" section of the contact card. */
  async getCallsByContact(organization: string, contactPhone: string): Promise<PhoneCall[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALLS_BY_CONTACT, { organization, contactPhone });
    const items = response.data?.Data ?? response.data?.data ?? [];
    return (Array.isArray(items) ? items : []).map(mapPbxCall);
  },

  /** AI summary, transcript and the agent's documentation of a call (same record the web call page shows). */
  async getCallSummary(organization: string, callId: string): Promise<any | null> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALL_SUMMARY, { organization, callId });
    return response.data?.Success && response.data?.Data ? response.data.Data : null;
  },

  /** Transcribes + summarizes a call's recording on demand (calls that got no automatic summary) and saves it on the call. */
  async generateCallSummary(organization: string, callId: string, recordingUrl: string, contactPhone: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.TRIGGER_CALL_SUMMARY, { organization, callId, recordingUrl, contactPhone, language: 'he' }, { timeout: 120000 });
    return response.data;
  },

  async saveCallNotes(
    organization: string,
    callId: string,
    doc: { notes: string; disposition?: string; tags?: string[] },
    contactPhone: string,
  ): Promise<{ success: boolean; error?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.SAVE_CALL_NOTES, {
      organization,
      callControlId: callId,
      notes: doc.notes,
      disposition: doc.disposition || '',
      tags: doc.tags || [],
      final: true,
      contactPhone,
    });
    return response.data?.success === false
      ? { success: false, error: response.data?.error }
      : { success: true };
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

  /** Incoming calls to the office number also ring THIS user's personal phone (own extension only, enforced server-side). */
  async setMyMobileRinging(
    organization: string,
    ringMobile: boolean,
    mobilePhone?: string,
  ): Promise<{ success: boolean; ringMobile?: boolean; mobilePhone?: string; error?: string; message?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.SET_MY_MOBILE_RINGING, { organization, ringMobile, mobilePhone });
    return response.data || { success: false };
  },

  /** Which number the CUSTOMER sees on this user's outgoing calls: the org number ('did') or the user's own mobile ('mobile'). Own extension only. */
  /** In-call controls for the agent's own live SIP call (the gateway does the work; hold plays the org's hold music). */
  async sipCallControl(
    organization: string,
    callId: string,
    action: 'status' | 'hold' | 'unhold' | 'mute' | 'unmute' | 'dtmf' | 'hangup' | 'transfer',
    digit?: string,
    transferTo?: { targetUserId?: string; number?: string },
  ): Promise<{ active?: boolean; answered?: boolean; held?: boolean; muted?: boolean; transfer?: '' | 'ringing' | 'done' | 'failed'; error?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.SIP_CALL_CONTROL, { organization, callId, action, digit, ...(transferTo || {}) });
    return response.data || {};
  },

  /** SIP login of THIS user for the in-app phone (same credentials the browser softphone uses). */
  async getSipCredentials(organization: string): Promise<{
    success?: boolean; wssUrl?: string; domain?: string; sipUser?: string; sipPassword?: string; extension?: string;
    iceServers?: { urls: string | string[]; username?: string; credential?: string }[];
  }> {
    const response = await axiosInstance.post(ENDPOINTS.SIP_CREDENTIALS, { organization });
    return response.data || {};
  },

  /**
   * Click-to-call through the SIP gateway, exactly like the web phone: the gateway rings THIS user's registered SIP
   * endpoints (the app's in-app phone auto-answers that leg), dials the customer and bridges + records the call.
   */
  async sipOutboundCall(payload: {
    organization: string;
    to: string;
    from: string;
    agentId: string;
    agentName: string;
    customerName?: string;
    link?: { type: string; id: string } | null;
  }): Promise<{ success?: boolean; callId?: string; error?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.STREAM_OUTBOUND_CALL, {
      organization: payload.organization,
      to: payload.to,
      from: payload.from,
      agentId: payload.agentId,
      agentName: payload.agentName,
      customerName: payload.customerName || '',
      link: payload.link || null,
      triggerBy: 'Manually',
      clientIdentity: payload.agentId,
      user: { userId: payload.agentId, userName: payload.agentName },
    });
    return response.data || {};
  },

  async setMyOutboundCallerId(
    organization: string,
    outboundCallerId: 'did' | 'mobile',
    mobilePhone?: string,
  ): Promise<{ success: boolean; outboundCallerId?: 'did' | 'mobile'; mobilePhone?: string; error?: string; message?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.SET_MY_OUTBOUND_CALLER_ID, { organization, outboundCallerId, mobilePhone });
    return response.data || { success: false };
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
    contactId?: string;
    leadId?: string;
    relatedTo?: { type: 'contact' | 'lead' | 'case'; entityId: string; entityName?: string };
  }): Promise<{ success: boolean; callId?: string; error?: string; message?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.TELNYX_OUTBOUND_CALL, payload);
    return response.data || {};
  },

  async initiateOutboundCall(
    organization: string,
    fromUserId: string,
    toPhoneNumber: string,
    fromNumberId?: string,
  ): Promise<{ success: boolean; callId?: string; error?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.INITIATE_OUTBOUND_CALL, {
      organization,
      fromUserId,
      toPhoneNumber,
      fromNumberId,
    });
    return response.data || {};
  },

  async getCallRecordings(
    organization: string,
    filters?: { callId?: string; phoneNumber?: string; page?: number; pageSize?: number },
  ): Promise<any[]> {
    const response = await axiosInstance.post(ENDPOINTS.GET_CALL_RECORDINGS, {
      organization,
      ...filters,
    });
    const raw = response.data;
    const items = raw?.Data ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return Array.isArray(items) ? items : [];
  },

  async getRecordingSettings(organization: string): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.GET_RECORDING_SETTINGS, { organization });
    return response.data?.Data || response.data?.data || response.data || {};
  },

  async updateRecordingSettings(
    organization: string,
    settings: { recordAllCalls?: boolean; recordOnlyWithLead?: boolean; recordOnlyWithActiveCase?: boolean },
  ): Promise<any> {
    const response = await axiosInstance.post(ENDPOINTS.UPDATE_RECORDING_SETTINGS, {
      organization,
      ...settings,
    });
    return response.data;
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

  /**
   * Report a device (personal-phone) call event so botomations can trigger on it.
   * Android-only: gated by the user's "report device call events" setting + Platform check
   * at the call sites. The backend fires missed_call / call_answered + call_ended.
   */
  async reportDeviceCallEvent(payload: {
    organization: string;
    callType: 'missed' | 'answered' | 'ended';
    callerPhone: string;
    calledNumber?: string;
    callerName?: string;
    callId?: string;
    durationSeconds?: number;
  }): Promise<{ success: boolean; callId?: string }> {
    const response = await axiosInstance.post(ENDPOINTS.REPORT_DEVICE_CALL_EVENT, payload);
    return response.data || {};
  },
};
