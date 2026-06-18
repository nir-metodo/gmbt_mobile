import { Linking, AppState, AppStateStatus, Platform } from 'react-native';
import { phoneCallsApi } from '../services/api/phoneCalls';
import { useSettingsStore } from '../stores/settingsStore';
import { CallEvents } from '../modules/call-events';

interface MakeCallOptions {
  phoneNumber: string;
  organization: string;
  callerUserId?: string;
  callerUserName?: string;
  relatedTo?: {
    type: 'contact' | 'lead' | 'case';
    entityId: string;
    entityName?: string;
  };
  contactName?: string;
}

export interface GambotCallOptions {
  phoneNumber: string;
  organization: string;
  agentPhone: string;
  fromPhoneNumber: string;
  agentId: string;
  agentName: string;
  customerName?: string;
  notes?: string;
  // CRM association so the recorded office-number call links to the contact/lead and shows in its timeline.
  contactId?: string;
  leadId?: string;
  relatedTo?: {
    type: 'contact' | 'lead' | 'case';
    entityId: string;
    entityName?: string;
  };
}

export interface GambotCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

let lastAppCall: { callId: string; organization: string; startTime: number; phoneNumber: string; contactName?: string } | null = null;

function handleAppStateChange(nextState: AppStateStatus) {
  if (nextState === 'active' && lastAppCall) {
    const durationSec = Math.round((Date.now() - lastAppCall.startTime) / 1000);
    phoneCallsApi
      .updateAppCall(lastAppCall.organization, lastAppCall.callId, {
        status: 'completed',
        duration: `${durationSec}`,
      })
      .catch(() => {});

    // Android-only fallback for surfacing this app-initiated call to the botomation engine.
    // Skipped when the native call-event receiver is present, since it already detects every
    // device call (incoming + outgoing) and would otherwise double-report this one.
    if (
      Platform.OS === 'android' &&
      !CallEvents.isSupported() &&
      useSettingsStore.getState().reportDeviceCallEventsEnabled
    ) {
      const answered = durationSec >= 5;
      phoneCallsApi
        .reportDeviceCallEvent({
          organization: lastAppCall.organization,
          callType: answered ? 'answered' : 'missed',
          callerPhone: lastAppCall.phoneNumber,
          callerName: lastAppCall.contactName,
          callId: lastAppCall.callId,
          durationSeconds: durationSec,
        })
        .catch(() => {});
    }

    lastAppCall = null;
  }
}

let appStateListener: { remove: () => void } | null = null;

export async function makeAppCall(options: MakeCallOptions): Promise<{ callId?: string } | void> {
  const { phoneNumber, organization, callerUserId, callerUserName, relatedTo, contactName } = options;

  if (!phoneNumber) return;

  try {
    const result = await phoneCallsApi.createAppCall(organization, {
      phoneNumber,
      contactName,
      direction: 'outbound' as any,
      status: 'initiated' as any,
      calledBy: callerUserId,
      calledByName: callerUserName,
      relatedTo: relatedTo as any,
      startTime: new Date().toISOString(),
      source: 'mobile_app',
    } as any);

    const callId = result?.callId || result?.id;
    if (callId) {
      lastAppCall = { callId, organization, startTime: Date.now(), phoneNumber, contactName };
      if (!appStateListener) {
        appStateListener = AppState.addEventListener('change', handleAppStateChange);
      }
    }
  } catch {
    // Don't block calling if logging fails
  }

  await Linking.openURL(`tel:${phoneNumber}`);
}

/**
 * Place a Gambot-routed call via Telnyx.
 * Flow: Telnyx calls the agent's phone → agent answers → Telnyx bridges to customer.
 * Call is recorded and logged in CRM automatically.
 */
export async function makeGambotCall(options: GambotCallOptions): Promise<GambotCallResult> {
  const { phoneNumber, organization, agentPhone, fromPhoneNumber, agentId, agentName, customerName, notes, contactId, leadId, relatedTo } = options;

  if (!phoneNumber || !agentPhone || !fromPhoneNumber) {
    return { success: false, error: 'missing_fields' };
  }

  try {
    const result = await phoneCallsApi.gambotOutboundCall({
      organizationName: organization,
      phoneNumber,
      fromPhoneNumber,
      agentPhone,
      agentIdentity: fromPhoneNumber,
      agentId,
      agentName,
      customerName,
      notes,
      contactId,
      leadId,
      relatedTo,
    });

    return {
      success: !!result.success,
      callId: result.callId,
      error: result.success ? undefined : 'call_failed',
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'network_error' };
  }
}

export interface SmartCallOptions {
  phoneNumber: string;
  organization: string;
  user: any;
  relatedTo?: { type: 'contact' | 'lead' | 'case'; entityId: string; entityName?: string };
  contactId?: string;
  leadId?: string;
  customerName?: string;
  /** Optional pre-loaded telephony settings to avoid an extra fetch. */
  telSettings?: any;
}

export interface SmartCallResult {
  mode: 'gambot' | 'native';
  success: boolean;
  error?: string;
}

/**
 * Single entry point for placing a call from anywhere in the app.
 * - If org telephony is enabled and we have an office number + agent cell, place a recorded,
 *   CRM-logged, contact/lead-associated office-number bridge call (makeGambotCall).
 * - Otherwise fall back to a logged native dialer call (makeAppCall), passing relatedTo so it still
 *   associates to the entity.
 * This is how every entity/list "Call" button gets the full integrated-telephony behavior.
 */
export async function placeSmartCall(opts: SmartCallOptions): Promise<SmartCallResult> {
  const { phoneNumber, organization, user, relatedTo, contactId, leadId, customerName } = opts;
  if (!phoneNumber) return { mode: 'native', success: false, error: 'missing_phone' };

  const telephonyEnabled = useSettingsStore.getState().telephonyEnabled;

  let settings = opts.telSettings;
  if (telephonyEnabled && !settings) {
    try {
      settings = await phoneCallsApi.getTelephonySettings(organization);
    } catch {
      settings = null;
    }
  }

  const fromNumber = settings?.defaultCallerId || settings?.phoneNumbers?.[0]?.number;
  const agentPhone = user?.phoneNumber || user?.PhoneNumber || user?.phone;

  if (telephonyEnabled && fromNumber && agentPhone) {
    const res = await makeGambotCall({
      phoneNumber,
      organization,
      agentPhone,
      fromPhoneNumber: fromNumber,
      agentId: user?.uID || user?.userId || '',
      agentName: user?.fullname || user?.FullName || user?.displayName || '',
      customerName,
      contactId: contactId || (relatedTo?.type === 'contact' ? relatedTo.entityId : undefined),
      leadId: leadId || (relatedTo?.type === 'lead' ? relatedTo.entityId : undefined),
      relatedTo,
    });
    if (res.success) return { mode: 'gambot', success: true };
    // fall through to native if the bridge couldn't be initiated
  }

  await makeAppCall({
    phoneNumber,
    organization,
    callerUserId: user?.uID || user?.userId || '',
    callerUserName: user?.fullname || user?.FullName || user?.displayName || '',
    relatedTo,
    contactName: customerName,
  });
  return { mode: 'native', success: true };
}
