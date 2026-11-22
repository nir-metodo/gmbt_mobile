import { Linking, AppState, AppStateStatus, Platform, Alert } from 'react-native';
import i18n from '../i18n';
import { phoneCallsApi } from '../services/api/phoneCalls';
import { useSettingsStore } from '../stores/settingsStore';
import { CallEvents } from '../modules/call-events';
import { useActiveCallStore } from '../stores/activeCallStore';
import { sipPhone } from '../services/sip/sipPhone';
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
  /** SIP orgs may have no caller-ID number configured yet - the gateway then uses its default DID. */
  allowEmptyFrom?: boolean;
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
  const { phoneNumber, organization, agentPhone, fromPhoneNumber, agentId, agentName, customerName, notes, contactId, leadId, relatedTo, allowEmptyFrom } = options;

  if (!phoneNumber || !agentPhone || (!fromPhoneNumber && !allowEmptyFrom)) {
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

    // SIP calls get the in-call control bar (hold / mute / keypad / hang up).
    if (result.success && result.callId && useSettingsStore.getState().telephonyProvider === 'sip') {
      useActiveCallStore.getState().start({ callId: result.callId, organization, phoneNumber, name: customerName });
    }

    return {
      success: !!result.success,
      callId: result.callId,
      error: result.success ? undefined : (result.error || 'call_failed'),
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'network_error' };
  }
}

/**
 * Place the call through the app's own SIP phone (internet call, same flow as the web phone). Returns true when the call was
 * started; false when this build/org can't (no WebRTC module, not registered in time, the backend refused) so the caller can fall
 * back to the "ring my phone first" bridge call or the device dialer.
 */
export async function tryInAppSipCall(opts: {
  phoneNumber: string;
  organization: string;
  user: any;
  relatedTo?: { type: 'contact' | 'lead' | 'case'; entityId: string; entityName?: string };
  contactId?: string;
  leadId?: string;
  customerName?: string;
}): Promise<boolean> {
  const { phoneNumber, organization, user, relatedTo, contactId, leadId, customerName } = opts;
  const userId = user?.uID || user?.userId || '';
  const st = useSettingsStore.getState();
  if (!phoneNumber || !userId || !st.telephonySolutionAvailable || st.telephonyProvider !== 'sip' || !sipPhone.isSupported()) return false;
  if (!(await sipPhone.waitRegistered(5000))) return false;

  const fromNumber = st.defaultCallerId || st.usableCallerNumbers?.[0]?.number || '';
  sipPhone.expectBridge();
  try {
    const linkType = relatedTo?.type || (contactId ? 'contact' : leadId ? 'lead' : '');
    const linkId = relatedTo?.entityId || contactId || leadId || '';
    const res = await phoneCallsApi.sipOutboundCall({
      organization,
      to: phoneNumber,
      from: fromNumber || organization,
      agentId: userId,
      agentName: user?.fullname || user?.FullName || user?.displayName || '',
      customerName,
      link: linkType && linkId ? { type: linkType, id: linkId } : null,
    });
    if (res.callId) {
      useActiveCallStore.getState().start({ callId: res.callId, organization, phoneNumber, name: customerName });
      return true;
    }
  } catch { /* fall back */ }
  sipPhone.cancelBridge();
  return false;
}

/** 'system' = the organization's line (in-app SIP / bridge call, recorded + logged); 'phone' = the device's own dialer. */
export type DialerKind = 'system' | 'phone';

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
 * Places the call with the given dialer.
 * - 'system':
 * - If the org has a usable calling solution (the SIP trunk; Twilio only for the master login) AND we know the
 *   agent's cell, place a recorded, CRM-logged, contact/lead-associated bridge call from the office number
 *   (makeGambotCall): the system rings the agent's phone, then connects the customer.
 * - Otherwise (no solution configured / not allowed / the bridge could not start) open the PHONE'S OWN dialer
 *   (makeAppCall) and only LOG that a call was made, passing relatedTo so it still associates to the entity.
 * This is how every entity/list/chat "Call" button gets the integrated-telephony behavior.
 */
export async function executeCall(opts: SmartCallOptions, dialer: DialerKind = 'system'): Promise<SmartCallResult> {
  const { phoneNumber, organization, user, relatedTo, contactId, leadId, customerName } = opts;
  if (!phoneNumber) return { mode: 'native', success: false, error: 'missing_phone' };

  const userId = user?.uID || user?.userId || '';
  let st = useSettingsStore.getState();
  // First call before the tabs layout finished loading the telephony settings: load them now (once).
  if (st.telephonyEnabled === null) {
    try { await st.loadTelephonySettings(organization, userId); } catch { /* fall back to the device dialer */ }
    st = useSettingsStore.getState();
  }

  const fromNumber = st.defaultCallerId || st.usableCallerNumbers?.[0]?.number || '';
  // The agent's cell: the user profile, else the mobile saved on their telephony extension (Settings → my mobile number).
  const agentPhone = user?.phoneNumber || user?.PhoneNumber || user?.phone || st.myExtension?.mobilePhone;
  const isSip = st.telephonyProvider === 'sip';

  // SIP org + this build has the in-app phone: talk through the app itself (internet call, like the web phone) - no "ring my
  // phone first" round trip. The gateway dials the customer, bridges and records; the app auto-answers its own leg.
  if (dialer === 'system' && await tryInAppSipCall({ phoneNumber, organization, user, relatedTo, contactId, leadId, customerName })) {
    return { mode: 'gambot', success: true };
  }
  if (dialer === 'system' && st.telephonySolutionAvailable && agentPhone && (fromNumber || isSip)) {
    const res = await makeGambotCall({
      phoneNumber,
      organization,
      agentPhone,
      fromPhoneNumber: fromNumber,
      allowEmptyFrom: isSip,
      agentId: user?.uID || user?.userId || '',
      agentName: user?.fullname || user?.FullName || user?.displayName || '',
      customerName,
      contactId: contactId || (relatedTo?.type === 'contact' ? relatedTo.entityId : undefined),
      leadId: leadId || (relatedTo?.type === 'lead' ? relatedTo.entityId : undefined),
      relatedTo,
    });
    if (res.success) return { mode: 'gambot', success: true };
    // The server refused (e.g. twilio_disabled) or the bridge couldn't start: fall through to the device dialer.
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

/** The dialer every call button opens first: the user's choice in Settings, else the system dialer when the org has one. */
export function getDefaultDialer(): DialerKind {
  const st = useSettingsStore.getState();
  if (!st.telephonySolutionAvailable) return 'phone';
  return st.defaultDialer === 'phone' ? 'phone' : 'system';
}

/**
 * Entry point for every "Call" button (chats, contacts, leads, cases, quotes...). Dials IMMEDIATELY - no confirmation sheet - with
 * the user's default dialer (Settings → Default dialer: the organization's line, or the phone's own dialer). What the customer sees
 * on a system-dialer call (the office number or the user's own mobile) is the user's "Customer sees my mobile number" setting,
 * applied server-side. Also reports a failed bridge call / the "your phone will ring" notice, so callers just fire-and-forget.
 */
export async function placeSmartCall(opts: SmartCallOptions): Promise<SmartCallResult> {
  if (!opts.phoneNumber) return { mode: 'native', success: false, error: 'missing_phone' };

  let st = useSettingsStore.getState();
  if (st.telephonyEnabled === null) {
    const userId = opts.user?.uID || opts.user?.userId || '';
    try { await st.loadTelephonySettings(opts.organization, userId); } catch { /* the phone's dialer is the fallback */ }
    st = useSettingsStore.getState();
  }

  try {
    const res = await executeCall(opts, getDefaultDialer());
    // A bridge call (non-SIP provider) rings the user's phone first - tell them. SIP calls show the in-call bar instead.
    if (res.mode === 'gambot' && res.success && useSettingsStore.getState().telephonyProvider !== 'sip') {
      Alert.alert(i18n.t('phoneCalls.gambotCallTitle', 'Gambot Call'), i18n.t('phoneCalls.callInitiated', 'Call initiated. Your phone will ring shortly.'));
    }
    return res;
  } catch {
    Alert.alert(i18n.t('common.error'), i18n.t('phoneCalls.gambotCallFailed', 'Failed to initiate call'));
    return { mode: 'native', success: false, error: 'call_failed' };
  }
}
